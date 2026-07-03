// scan-selftest.mjs
//
// Proves the EXTERNAL scanner tiers actually fire — a scanner that has never
// been seen to go red is a false-clear. Runs gitleaks and osv-scanner over
// planted-dirty fixtures and a clean fixture, asserting each flags the dirty one
// and clears the clean one. Requires both binaries on PATH (or GITLEAKS_BIN /
// OSV_BIN); CI installs them. The built-in static tier is covered separately by
// gate-selftest.mjs.
import { mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { bin, runGitleaks, runOsv, runSemgrep } from "./scan.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (name) => join(ROOT, "fixtures", name);
const work = mkdtempSync(join(tmpdir(), "scan-selftest-"));

let ok = true;
function check(label, cond) {
  if (!cond) ok = false;
  console.log(`${cond ? "✓" : "✗"} ${label}`);
}

const gitleaks = bin("gitleaks", "GITLEAKS_BIN");
const osv = bin("osv-scanner", "OSV_BIN");
const semgrep = bin("semgrep", "SEMGREP_BIN");
check("gitleaks binary present", !!gitleaks);
check("osv-scanner binary present", !!osv);
check("semgrep binary present", !!semgrep);

if (gitleaks) {
  const dirty = runGitleaks(gitleaks, fx("dirty-secret"), work);
  const clean = runGitleaks(gitleaks, fx("clean-skill"), work);
  check(`gitleaks FLAGS planted secret (${dirty.findings.length} finding(s))`, dirty.ran && dirty.findings.length > 0);
  check("gitleaks CLEARS clean fixture", clean.ran && clean.findings.length === 0);
}

if (osv) {
  const dirty = runOsv(osv, fx("dirty-deps"));
  const clean = runOsv(osv, fx("clean-skill"));
  check(`osv-scanner FLAGS planted vuln dependency (${dirty.findings.length} finding(s))`, dirty.ran && dirty.findings.length > 0);
  check("osv-scanner CLEARS clean fixture (no manifests)", clean.ran && clean.findings.length === 0);
}

if (semgrep) {
  const dirty = runSemgrep(semgrep, fx("dirty-sast"));
  const clean = runSemgrep(semgrep, fx("clean-skill"));
  check(`semgrep FLAGS dangerous code (${dirty.findings.length} finding(s))`, dirty.ran && dirty.findings.length > 0);
  check("semgrep CLEARS clean fixture", clean.ran && clean.findings.length === 0);
}

if (!ok) {
  console.error("✗ scan self-test FAILED: a scanner tier did not fire/clear as expected");
  process.exit(1);
}
console.log("✓ scan self-test passed: external scanners fire on dirty, clear on clean");
