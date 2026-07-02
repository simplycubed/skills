// fetch-and-scan.mjs — the per-skill certification runner.
//
//   node scripts/fetch-and-scan.mjs <slug> [flags]
//   node scripts/fetch-and-scan.mjs --repo <owner/name> --sha <40hex> [--path <subdir>] [flags]
//
// Fetches the upstream skill at its pinned commit SHA, VERIFIES the checked-out
// commit hash equals the pin (so we scan exactly the bytes that will install),
// then runs the static checks (certify.mjs: structure/license/injection) plus the
// external scanners (gitleaks, semgrep, osv-scanner). Writes config/skills/
// <slug>.scan.json and exits non-zero on any finding — fail-closed.
//
// Flags:
//   --allow-missing-scanners  local dev: a missing external scanner is recorded as
//                             "skipped" and the record is marked incomplete (never
//                             "certified"). CI must NOT pass this — missing tool = fail.
//   --dry-run                 do not write the scan record (print it).
//   --repo/--sha/--path       scan an arbitrary target without a config (testing).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const allowMissing = flag("--allow-missing-scanners");
const dryRun = flag("--dry-run");

function fail(msg) { console.error(`✗ ${msg}`); process.exit(2); }
function sh(cmd, args, cwd) { return spawnSync(cmd, args, { cwd, encoding: "utf8" }); }
function has(bin) { return spawnSync(bin, ["--version"], { encoding: "utf8" }).status === 0; }

// --- resolve the target (config slug OR --repo/--sha/--path) ---
let slug = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--repo" && argv[argv.indexOf(a) - 1] !== "--sha" && argv[argv.indexOf(a) - 1] !== "--path");
let repo = opt("--repo"), sha = opt("--sha"), skillPath = opt("--path"), license;

if (!repo) {
  if (!slug) fail("usage: fetch-and-scan.mjs <slug> | --repo <owner/name> --sha <40hex> [--path <subdir>]");
  const cfgPath = join(ROOT, "config/skills", `${slug}.yaml`);
  if (!existsSync(cfgPath)) fail(`no config for slug "${slug}" at ${cfgPath}`);
  const cfg = yaml.load(readFileSync(cfgPath, "utf8"));
  repo = cfg.upstream.repo; sha = cfg.upstream.sha; skillPath = cfg.upstream.path; license = cfg.license;
}
if (!/^[0-9a-f]{40}$/.test(sha || "")) fail(`sha must be a full 40-hex commit, got: ${sha}`);

// --- fetch the exact commit and verify integrity ---
const work = mkdtempSync(join(tmpdir(), "sc-scan-"));
try {
  sh("git", ["init", "-q", work]);
  sh("git", ["-C", work, "remote", "add", "origin", `https://github.com/${repo}.git`]);
  let f = sh("git", ["-C", work, "fetch", "-q", "--depth", "1", "origin", sha]);
  if (f.status !== 0) f = sh("git", ["-C", work, "fetch", "-q", "origin", sha]); // fallback: server may not allow shallow-by-sha
  if (f.status !== 0) fail(`could not fetch ${repo}@${sha}: ${f.stderr?.trim()}`);
  const co = sh("git", ["-C", work, "checkout", "-q", sha]);
  if (co.status !== 0) fail(`could not checkout ${sha}: ${co.stderr?.trim()}`);

  const head = sh("git", ["-C", work, "rev-parse", "HEAD"]).stdout.trim();
  if (head !== sha) fail(`INTEGRITY: checked-out HEAD ${head} != pinned ${sha}`);
  const treeHash = sh("git", ["-C", work, "rev-parse", "HEAD^{tree}"]).stdout.trim();

  // resolve skill dir (guard against path escaping the repo)
  const skillDir = skillPath ? resolve(work, skillPath) : work;
  if (relative(work, skillDir).startsWith("..")) fail(`path "${skillPath}" escapes the repo`);
  if (!existsSync(skillDir)) fail(`path "${skillPath}" not found at ${repo}@${sha}`);

  // --- static checks (reuse certify.mjs) ---
  const c = sh(process.execPath, [join(ROOT, "scripts/certify.mjs"), skillDir]);
  let certify;
  try { certify = JSON.parse(c.stdout); } catch { fail(`certify.mjs did not return JSON: ${c.stdout}${c.stderr}`); }

  // --- external scanners (fail-closed by default) ---
  const scanners = [
    { tool: "gitleaks", bin: "gitleaks", run: (d, out) => sh("gitleaks", ["detect", "--source", d, "--no-git", "--report-format", "json", "--report-path", out, "--exit-code", "1"], work), leakExit: 1 },
    { tool: "semgrep", bin: "semgrep", run: (d, out) => sh("semgrep", ["scan", "--config", "auto", "--error", "--quiet", "--json", "--output", out, d], work), leakExit: 1 },
    { tool: "osv-scanner", bin: "osv-scanner", run: (d, out) => sh("osv-scanner", ["--format", "json", "--output", out, "-r", d], work), leakExit: 1 },
  ];
  const scanResults = [];
  let missingRequired = false;
  for (const s of scanners) {
    if (!has(s.bin)) {
      scanResults.push({ tool: s.tool, status: allowMissing ? "skipped" : "missing" });
      if (!allowMissing) missingRequired = true;
      continue;
    }
    const out = join(work, `${s.tool}.json`);
    const r = s.run(skillDir, out);
    scanResults.push({ tool: s.tool, status: r.status === 0 ? "pass" : r.status === s.leakExit ? "fail" : "error", exit: r.status });
  }

  const scannerFail = scanResults.some((r) => r.status === "fail" || r.status === "error" || r.status === "missing");
  const incomplete = scanResults.some((r) => r.status === "skipped");
  const passed = certify.passed && !scannerFail && !missingRequired;

  const record = {
    slug: slug || null,
    upstream: { repo, sha, ...(skillPath ? { path: skillPath } : {}) },
    verified_sha: head,
    tree_hash: treeHash,
    license: license || null,
    checks: { ...certify.checks, scanners: scanResults },
    scanned_at: new Date().toISOString(),
    incomplete,
    passed: passed && !incomplete ? true : false,
    status: incomplete ? "incomplete" : passed ? "certified" : "failed",
  };

  console.log(JSON.stringify(record, null, 2));
  if (!dryRun && slug) {
    writeFileSync(join(ROOT, "config/skills", `${slug}.scan.json`), JSON.stringify(record, null, 2) + "\n");
  }
  process.exit(record.passed ? 0 : 1);
} finally {
  rmSync(work, { recursive: true, force: true });
}
