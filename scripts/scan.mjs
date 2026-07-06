// scan.mjs <slug> [--write]
//
// The fetch-and-scan certification step. Assembles the published unit
// (fetch.mjs), then runs every certification tier over exactly those bytes and
// emits a scan record:
//   - built-in static (certify.mjs): structure, license, blocking-injection,
//     plus surfaced REVIEW findings
//   - gitleaks:     secret scanning
//   - osv-scanner:  known-vulnerability check on any dependency manifests
//
// `passed` = no blocking findings across all tiers AND every required scanner
// actually ran (missing scanner => fail closed, never a silent skip). With
// --write the record is saved to config/skills/<slug>.scan.json, which
// generate.mjs turns into the catalog's certification badge. CI re-runs this on
// the freshly fetched bytes and fails if the live verdict isn't a pass, so a
// hand-edited scan.json cannot smuggle a failing skill through.
import { writeFileSync, readFileSync, existsSync, mkdtempSync, readdirSync, lstatSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig, assembleUnit, licenseVerdict } from "./fetch.mjs";
import { certify } from "./certify.mjs";
import { readManifest, materializeUnit } from "./snapshot.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "config/skills");
const SEMGREP_RULES = join(ROOT, "config/semgrep-rules.yml");

// Extensions that mean "this unit contains executable code" — the trigger for the
// SAST tier. A docs-only skill (no code) has nothing for semgrep to analyze.
const CODE_EXTS = new Set(["py","js","mjs","cjs","ts","tsx","jsx","sh","bash","rb","go","php","java","pl","lua","ps1"]);
function hasCode(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (lstatSync(full).isDirectory()) { if (hasCode(full)) return true; }
    else if (CODE_EXTS.has((name.split(".").pop() || "").toLowerCase())) return true;
  }
  return false;
}

export function bin(name, envVar) {
  const override = envVar ? process.env[envVar] : null;
  if (override && existsSync(override)) return override;
  const which = spawnSync("command", ["-v", name], { shell: true, encoding: "utf8" });
  return which.status === 0 ? which.stdout.trim() : null;
}

function toolVersion(path, args) {
  const r = spawnSync(path, args, { encoding: "utf8" });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  const m = out.match(/\d+\.\d+\.\d+/); // extract the semver from e.g. "osv-scanner version: 2.4.0"
  return m ? m[0] : (out.split("\n")[0] || "unknown");
}

// gitleaks: scan the unit as a plain directory (no git history). We force
// exit-code 0 and read the JSON report so a "leaks found" exit doesn't look like
// a tool crash; findings are counted from the report itself.
export function runGitleaks(path, unit, work) {
  const report = join(work, "gitleaks.json");
  const r = spawnSync(path, [
    "detect", "--no-git", "--source", unit,
    "--report-format", "json", "--report-path", report,
    "--exit-code", "0", "--no-banner",
  ], { encoding: "utf8" });
  if (r.status !== 0 && !existsSync(report)) {
    return { ran: false, error: `gitleaks failed: ${(r.stderr || "").trim() || r.status}`, findings: [] };
  }
  let leaks = [];
  try { leaks = JSON.parse(readFileSync(report, "utf8")) || []; } catch { leaks = []; }
  const findings = leaks.map((l) => `${l.File || l.file || "?"}: ${l.RuleID || l.Description || "secret"}`);
  return { ran: true, findings };
}

// osv-scanner: check any dependency manifests in the unit for known vulns. Exit
// 1 = vulns found, 0 = clean, 128 = "no packages found" (a skill with no
// lockfiles) which we treat as a clean pass, not an error.
export function runOsv(path, unit) {
  const r = spawnSync(path, ["--format", "json", "--recursive", unit], { encoding: "utf8" });
  if (r.status === 128 || /No package sources found|no files/i.test(r.stderr || "")) {
    return { ran: true, findings: [], note: "no dependency manifests" };
  }
  let data;
  try { data = JSON.parse(r.stdout || "{}"); } catch {
    return { ran: false, error: `osv-scanner output unparseable: ${(r.stderr || "").trim() || r.status}`, findings: [] };
  }
  const findings = [];
  for (const res of data.results || []) {
    for (const pkg of res.packages || []) {
      const name = pkg.package?.name || "?";
      for (const v of pkg.vulnerabilities || []) findings.push(`${name}: ${v.id}`);
    }
  }
  return { ran: true, findings };
}

// Run every scanner tier over an ALREADY-ASSEMBLED unit (no network). Split out
// from scan() so the fail-closed behaviour (a required scanner missing =>
// passed:false) is unit-testable without a live fetch.
// semgrep SAST over bundled scripts. Deterministic: --config points at our pinned
// local ruleset (never --config auto), and telemetry/version checks are disabled,
// so no rules are fetched and the verdict can't drift with the registry.
export function runSemgrep(path, unit) {
  const r = spawnSync(path, [
    "scan", "--config", SEMGREP_RULES,
    "--json", "--quiet", "--metrics", "off", "--disable-version-check", unit,
  ], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
  let data;
  try { data = JSON.parse(r.stdout || "{}"); } catch {
    return { ran: false, error: `semgrep output unparseable: ${(r.stderr || "").trim() || r.status}`, findings: [] };
  }
  const findings = (data.results || []).map((f) => `${basename(f.path)}: ${f.check_id}`);
  return { ran: true, findings };
}

export function scanUnit(slug, assembled, { now = new Date().toISOString(), allowMissing = false } = {}) {
  const unit = assembled.unitDir;
  // Scanner scratch (gitleaks report) goes to a temp dir — never beside the unit,
  // which for a snapshot is a committed directory we must not pollute.
  const work = mkdtempSync(join(tmpdir(), `scan-${slug}-`));

  // Built-in static tier over the assembled unit (LICENSE now present).
  const c = certify(unit);

  // External scanners. By default a required scanner that isn't installed fails
  // the scan (fail-closed). With allowMissing (local dev only, never CI), a
  // missing scanner is recorded "skipped" and the record is marked incomplete —
  // an incomplete record can never be shown as "certified".
  const gitleaksBin = bin("gitleaks", "GITLEAKS_BIN");
  const osvBin = bin("osv-scanner", "OSV_BIN");
  const tools = { certify: "builtin" };
  const scanErrors = [];
  let incomplete = false;

  let secrets = [];
  if (gitleaksBin) {
    tools.gitleaks = toolVersion(gitleaksBin, ["version"]);
    const g = runGitleaks(gitleaksBin, unit, work);
    if (!g.ran) scanErrors.push(g.error); else secrets = g.findings;
  } else if (allowMissing) {
    tools.gitleaks = "skipped"; incomplete = true;
  } else {
    scanErrors.push("gitleaks not installed (required)");
  }

  let vulnerabilities = [];
  if (osvBin) {
    tools["osv-scanner"] = toolVersion(osvBin, ["--version"]);
    const o = runOsv(osvBin, unit);
    if (!o.ran) scanErrors.push(o.error); else vulnerabilities = o.findings;
  } else if (allowMissing) {
    tools["osv-scanner"] = "skipped"; incomplete = true;
  } else {
    scanErrors.push("osv-scanner not installed (required)");
  }

  // SAST — only when the unit actually contains code. A docs-only skill has
  // nothing for semgrep to analyze, so it is not required there (stays certified).
  let sast = [];
  if (hasCode(unit)) {
    const semgrepBin = bin("semgrep", "SEMGREP_BIN");
    if (semgrepBin) {
      tools.semgrep = toolVersion(semgrepBin, ["--version"]);
      const sg = runSemgrep(semgrepBin, unit);
      if (!sg.ran) scanErrors.push(sg.error); else sast = sg.findings;
    } else if (allowMissing) {
      tools.semgrep = "skipped"; incomplete = true;
    } else {
      scanErrors.push("semgrep not installed (required for skills containing code)");
    }
  } else {
    tools.semgrep = "n/a (no code)";
  }

  // License must be present AND match the declared SPDX id in the published unit.
  const licenseChecks = [...c.checks.license];
  if (assembled.licenseMatches === false) {
    licenseChecks.push(`LICENSE text does not match declared '${assembled.declaredLicense}'`);
  }

  const checks = {
    // structure guard (certify) + escaping/dangling symlinks caught during assembly
    structure: [...c.checks.structure, ...(assembled.symlinkFindings || [])],
    license: licenseChecks,
    injection: c.checks.injection, // blocking tier
    secrets,
    vulnerabilities,
    sast, // semgrep, blocking (empty when the unit has no code)
  };
  const blocking = Object.values(checks).flat();
  const passed = blocking.length === 0 && scanErrors.length === 0;

  return {
    slug,
    upstream: { repo: assembled.repo, sha: assembled.sha, path: assembled.path },
    scanned_at: now,
    unit: {
      licenseSource: assembled.licenseSource,
      declaredLicense: assembled.declaredLicense,
      licenseMatches: assembled.licenseMatches,
    },
    tools,
    checks,
    review: c.review, // non-blocking, surfaced for LLM-judge / human review
    scan_errors: scanErrors,
    incomplete, // a required scanner was skipped (allowMissing) — never "certified"
    passed,
    finding_count: blocking.length,
    review_count: c.review.length,
    note: "built-in static tier + gitleaks (secrets) + osv-scanner (deps) + semgrep SAST (pinned rules, code-only). REVIEW findings are surfaced, not auto-failed. SKILL.md LLM-judge is a planned follow-up.",
  };
}

export function scan(slug, { now = new Date().toISOString(), allowMissing = false } = {}) {
  const cfg = loadConfig(slug);
  const assembled = assembleUnit(cfg);
  return scanUnit(slug, assembled, { now, allowMissing });
}

// Re-verify a skill from its committed SNAPSHOT — no upstream fetch. This is what
// certify:active runs in CI, so certification stays green even if the upstream
// repo disappears (the README's durability promise).
export function scanSnapshot(slug, { now = new Date().toISOString() } = {}) {
  const cfg = loadConfig(slug);
  const manifest = readManifest(slug);
  if (!manifest) throw new Error(`no snapshot for ${slug} — run: pnpm snapshot ${slug} --write`);
  // Source the unit from local OR R2 (content-addressed, re-hashed vs manifest,
  // fail-closed). Survives PR-7 deleting the local bytes; SKILLS_FORCE_R2=1 forces R2.
  const mat = materializeUnit(slug, manifest);
  try {
    const unit = mat.dir;
    const lv = licenseVerdict(unit, cfg.license);
    const assembled = {
      unitDir: unit,
      repo: manifest.upstream.repo,
      sha: manifest.upstream.sha,
      path: manifest.upstream.path,
      licenseSource: "snapshot",
      declaredLicense: cfg.license,
      licenseMatches: lv.licenseMatches,
      symlinkFindings: [], // snapshots are assembled symlink-free
    };
    return scanUnit(slug, assembled, { now });
  } finally {
    mat.cleanup();
  }
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const allowMissing = args.includes("--allow-missing-scanners"); // local dev only; never CI
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) { console.error("usage: node scripts/scan.mjs <slug> [--write] [--allow-missing-scanners]"); process.exit(2); }

  const record = scan(slug, { allowMissing });
  const json = JSON.stringify(record, null, 2) + "\n";
  if (write) {
    const out = join(SKILLS_DIR, `${slug}.scan.json`);
    writeFileSync(out, json);
    console.error(`wrote ${out}`);
  } else {
    process.stdout.write(json);
  }
  if (!record.passed) {
    console.error(`✗ ${slug}: ${record.finding_count} blocking finding(s)` +
      (record.scan_errors.length ? `, scan errors: ${record.scan_errors.join("; ")}` : ""));
    process.exit(1);
  }
  console.error(`${record.incomplete ? "⚠" : "✓"} ${slug}: ${record.incomplete ? "INCOMPLETE (scanners skipped) — not certifiable" : "certified"} (${record.review_count} review flag(s))`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
