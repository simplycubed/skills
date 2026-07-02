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

const MAX_FILE_BYTES = 2 * 1024 * 1024; // skills are text; a big blob is suspicious
const LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.md"];

// Prompt-injection / exfiltration heuristics. Case-insensitive. This is a filter,
// not a proof: it catches known-bad patterns, not novel or obfuscated attacks.
const INJECTION_PATTERNS = [
  [/ignore\s+(all\s+)?(the\s+)?(previous|prior|above)\s+instructions/i, "override of prior instructions"],
  [/disregard\s+(the\s+)?(system|previous|prior|above)/i, "disregard-instructions phrasing"],
  [/\bid_rsa\b|\bid_ed25519\b|\.ssh\/|\.aws\/credentials|\.env\b/i, "reference to secret/credential files"],
  [/curl[^\n]*\|\s*(sh|bash|zsh)\b|wget[^\n]*\|\s*(sh|bash|zsh)\b/i, "pipe-to-shell download"],
  [/base64\s+(-d|--decode)[^\n]*\|\s*(sh|bash|python)/i, "decode-and-execute"],
  [/exfiltrat|exfil\b/i, "explicit exfiltration language"],
  [/POST\s+[^\n]*\b(token|secret|key|password|credential)/i, "posting secrets to a remote"],
  [/\beval\s*\(|child_process|os\.system\(|subprocess\.(run|call|Popen)/i, "instruction to run arbitrary code"],
];

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

function injectionScan(dir) {
  const findings = [];
  const files = walk(dir, resolve(dir)).filter(
    (f) => !f.symlink && /\.(md|markdown|txt)$/i.test(f.name)
  );
  for (const f of files) {
    let text;
    try { text = readFileSync(f.full, "utf8"); } catch { continue; }
    for (const [re, label] of INJECTION_PATTERNS) {
      if (re.test(text)) findings.push(`${basename(f.full)}: ${label}`);
    }
  }
  return findings;
}

function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) {
    console.error("usage: node scripts/certify.mjs <skill-dir>");
    process.exit(2);
  }
  const checks = {
    structure: structureGuard(dir),
    license: licenseCheck(dir),
    injection: injectionScan(dir),
  };
  const findings = Object.values(checks).flat();
  const verdict = {
    target: dir,
    checks,
    passed: findings.length === 0,
    finding_count: findings.length,
    note: "v1 static checks (structure/license/injection heuristic). External scanners and LLM-judge run separately.",
  };
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.passed ? 0 : 1);
}

main();
