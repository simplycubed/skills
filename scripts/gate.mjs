// gate.mjs — the aggregate local gate. One command (`pnpm gate`) the loop runs to
// self-check before pushing. Runs every fast, hermetic check in order; the
// scanner-dependent steps (scan:selftest, certify:active) are marked SKIPPED-local
// when their binaries (gitleaks/osv-scanner/semgrep) are absent — CI is authoritative
// for those. Exits non-zero on any real failure.
import { spawnSync } from "node:child_process";

const has = (bin) => spawnSync("bash", ["-lc", `command -v ${bin}`], { encoding: "utf8" }).status === 0;
const scanners = ["gitleaks", "osv-scanner", "semgrep"];
const scannersPresent = scanners.every(has);

// [script, requiresScanners]
const steps = [
  ["workflow:lint", false],
  ["validate", false],
  ["gate:selftest", false],
  ["unit:selftest", false],
  ["r2:selftest", false],
  ["r2:migrate:check", false],
  ["snapshot:selftest", false],
  ["generate:selftest", false],
  ["generate:check", false],
  ["catalog:check", false],
  ["snapshot:check", false],
  ["revoke:selftest", false],
  ["scan:selftest", true],
  ["certify:active", true],
];

let failed = 0, skipped = 0, passed = 0;
for (const [script, needsScanners] of steps) {
  if (needsScanners && !scannersPresent) {
    skipped++;
    console.log(`⤼ SKIPPED-local  ${script}  (scanner binary absent; CI authoritative)`);
    continue;
  }
  const r = spawnSync("pnpm", ["-s", "run", script], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.log(`✗ FAIL  ${script}`); }
  else { passed++; console.log(`✓ PASS  ${script}`); }
}

console.log(`\ngate: ${passed} passed, ${failed} failed, ${skipped} skipped-local`);
if (!scannersPresent) console.log(`  (install ${scanners.join(", ")} to run the scanner steps locally)`);
process.exit(failed ? 1 : 0);
