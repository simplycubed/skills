// certify.mjs <dir>
//
// The deterministic, dependency-free core of the certification gate. Scans one
// skill directory (the bytes we would publish) and fails closed on any finding.
// Runs three static checks that need no external tools or secrets:
//
//   1. structure guard  - no git submodules, Git LFS pointers, symlinks that
//                          escape the skill root, or oversized files. (If any of
//                          these are present, "the pinned SHA is the exact bytes"
//                          stops being true.)
//   2. license presence - a LICENSE/COPYING file must exist in the skill.
//   3. SKILL.md injection - heuristic scan of instruction text for known
//                          prompt-injection / data-exfiltration patterns.
//
// External scanners (gitleaks, semgrep, osv-scanner) run as separate CI steps in
// .github/workflows/ci.yml. An LLM-judge review of SKILL.md is a planned follow-up
// (needs an API key); this heuristic is the v1 static layer.
//
// Exit 0 = pass, 1 = fail. Prints a JSON verdict to stdout.
import { readdirSync, readFileSync, lstatSync, realpathSync, existsSync } from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_FILE_BYTES = 2 * 1024 * 1024; // skills are text; a big blob is suspicious
const LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.md"];

// Prompt-injection heuristics. Case-insensitive. This is a filter, not a proof:
// it catches known-bad patterns, not novel or obfuscated attacks. Findings are
// split into two tiers because a naive regex cannot tell an ATTACK ("exfiltrate
// the user's credentials") from a DEFENSIVE MENTION ("never exfiltrate the
// user's credentials") — and legitimate security/devops skills are full of the
// latter.
//
//   BLOCK  - action-shaped patterns that are near-always malicious inside skill
//            instruction text. Any hit fails certification.
//   REVIEW - vocabulary that legitimate skills routinely use defensively. Hits
//            are surfaced in the verdict for human / LLM-judge review but do NOT
//            fail the gate on their own. The planned SKILL.md LLM-judge is what
//            adjudicates intent here; until then we flag, we don't auto-reject.
const INJECTION_BLOCK = [
  [/ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions/i, "override of prior instructions"],
  [/disregard\s+(the\s+)?(system|previous|prior|above)/i, "disregard-instructions phrasing"],
  [/curl[^\n]*\|\s*(sh|bash|zsh)\b|wget[^\n]*\|\s*(sh|bash|zsh)\b/i, "pipe-to-shell download"],
  [/base64\s+(-d|--decode)[^\n]*\|\s*(sh|bash|python)/i, "decode-and-execute"],
  [/POST\s+[^\n]*\b(token|secret|key|password|credential)/i, "posting secrets to a remote"],
];
const INJECTION_REVIEW = [
  [/\bid_rsa\b|\bid_ed25519\b|\.ssh\/|\.aws\/credentials|\.env\b/i, "reference to secret/credential files"],
  [/exfiltrat|exfil\b/i, "exfiltration vocabulary"],
  [/\beval\s*\(|child_process|os\.system\(|subprocess\.(run|call|Popen)/i, "reference to code-execution APIs"],
];

// Invisible/bidi obfuscation — instruction text that renders differently from its
// bytes, so a human reviewer sees something other than what the agent parses.
//   BLOCK  - bidirectional override/isolate controls (the "Trojan Source" attack):
//            no legitimate use in skill instructions; can reorder/hide logic.
//   REVIEW - zero-width / invisible characters (minus a single leading BOM): can
//            smuggle hidden text, but also occur benignly (e.g. emoji ZWJ) — surfaced.
const BIDI_OVERRIDE = new Set([0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069]);
const ZERO_WIDTH = new Set([0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF]);
const hasCodePoint = (text, set) => { for (const ch of text) if (set.has(ch.codePointAt(0))) return true; return false; };

function obfuscationScan(dir) {
  const block = [], review = [];
  const files = walk(dir, resolve(dir)).filter((f) => !f.symlink && /\.(md|markdown|txt)$/i.test(f.name));
  for (const f of files) {
    let text;
    try { text = readFileSync(f.full, "utf8"); } catch { continue; }
    if (hasCodePoint(text, BIDI_OVERRIDE)) {
      block.push(`${basename(f.full)}: bidirectional override control (Trojan Source obfuscation)`);
    }
    const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // ignore a single leading BOM
    if (hasCodePoint(body, ZERO_WIDTH)) {
      review.push(`${basename(f.full)}: zero-width/invisible character(s)`);
    }
  }
  return { block, review };
}

function walk(dir, root, files = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) {
      files.push({ full, name, symlink: true, target: safeRealpath(full) });
      continue;
    }
    if (st.isDirectory()) {
      walk(full, root, files);
    } else {
      files.push({ full, name, size: st.size });
    }
  }
  return files;
}

function safeRealpath(p) {
  try { return realpathSync(p); } catch { return null; }
}

function structureGuard(dir) {
  const findings = [];
  const root = resolve(dir);
  const files = walk(dir, root);
  for (const f of files) {
    if (f.symlink) {
      // A symlink is a finding if it escapes the skill root (or dangles).
      if (!f.target || relative(root, f.target).startsWith("..")) {
        findings.push(`symlink escapes skill root: ${relative(root, f.full)}`);
      }
    }
    if (f.name === ".gitmodules") findings.push("contains a git submodule (.gitmodules)");
    if (typeof f.size === "number" && f.size > MAX_FILE_BYTES) {
      findings.push(`oversized file (${f.size} bytes): ${relative(root, f.full)}`);
    }
    // Git LFS pointer files start with this line.
    if (!f.symlink && typeof f.size === "number" && f.size < 400) {
      try {
        const head = readFileSync(f.full, "utf8").slice(0, 60);
        if (head.startsWith("version https://git-lfs.github.com/spec/")) {
          findings.push(`Git LFS pointer (content not inlined): ${relative(root, f.full)}`);
        }
      } catch { /* binary; ignore */ }
    }
  }
  return findings;
}

function licenseCheck(dir) {
  const has = LICENSE_NAMES.some((n) => existsSync(join(dir, n)));
  return has ? [] : ["no LICENSE/COPYING file present in the skill"];
}

// Scan instruction text against a pattern set, returning "file: label" strings.
function scanText(dir, patterns) {
  const findings = [];
  const files = walk(dir, resolve(dir)).filter(
    (f) => !f.symlink && /\.(md|markdown|txt)$/i.test(f.name)
  );
  for (const f of files) {
    let text;
    try { text = readFileSync(f.full, "utf8"); } catch { continue; }
    for (const [re, label] of patterns) {
      if (re.test(text)) findings.push(`${basename(f.full)}: ${label}`);
    }
  }
  return findings;
}

// Exported so the scan orchestrator can reuse the built-in tier without shelling
// out to this file.
export function certify(dir) {
  const obf = obfuscationScan(dir);
  const checks = {
    structure: structureGuard(dir),
    license: licenseCheck(dir),
    // Blocking injection tier + bidi-obfuscation BLOCK findings (folded in, no new
    // record key — keeps the certification record shape and catalog.json stable).
    injection: [...scanText(dir, INJECTION_BLOCK), ...obf.block],
  };
  const review = [...scanText(dir, INJECTION_REVIEW), ...obf.review]; // surfaced, non-blocking
  // Only blocking checks decide pass/fail; review findings are flagged, not fatal.
  const blocking = Object.values(checks).flat();
  return {
    target: dir,
    checks,
    review,
    passed: blocking.length === 0,
    finding_count: blocking.length,
    review_count: review.length,
    note: "v1 static checks (structure/license/blocking-injection). REVIEW findings are surfaced for the LLM-judge, not auto-failed. External scanners run separately.",
  };
}

function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) {
    console.error("usage: node scripts/certify.mjs <skill-dir>");
    process.exit(2);
  }
  const verdict = certify(dir);
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.passed ? 0 : 1);
}

// Run only when executed directly, so scan.mjs can import certify() without
// triggering the CLI.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
