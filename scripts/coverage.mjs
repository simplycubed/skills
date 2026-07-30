// coverage.mjs — run the hermetic selftests under V8 coverage and emit lcov.
//
// The suite is ~15 plain `node scripts/*-selftest.mjs` runs rather than Jest or
// Vitest, so none of Codecov's framework recipes apply. Rather than wrap each run
// in its own c8 process (which would leave one report per run to merge), this sets
// NODE_V8_COVERAGE once and lets V8 append a profile per child process into a
// shared directory. `c8 report` then reads that directory and writes a single
// lcov.info covering every script the suite touched.
//
// Scanner-dependent steps are excluded on purpose: they need gitleaks/osv-scanner/
// semgrep on PATH, and a coverage run that silently skipped them would report a
// lower number on machines without the binaries. What runs here is the hermetic
// subset, so the figure means the same thing locally and in CI.
import { spawnSync } from "node:child_process";
import { rmSync, mkdirSync, existsSync } from "node:fs";

const COVERAGE_DIR = ".coverage";
const TMP_DIR = `${COVERAGE_DIR}/tmp`;

// The hermetic selftests, in the order `pnpm gate` runs them. Keep this in step
// with the non-scanner entries in scripts/gate.mjs.
const selftests = [
  "scripts/gate-selftest.mjs",
  "scripts/unit-selftest.mjs",
  "scripts/r2-selftest.mjs",
  "scripts/snapshot-selftest.mjs",
  "scripts/generate-selftest.mjs",
  "scripts/revoke-selftest.mjs",
  "scripts/versions-selftest.mjs",
];

rmSync(COVERAGE_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });

let failed = 0;
for (const script of selftests) {
  if (!existsSync(script)) {
    console.error(`✗ ${script} is listed for coverage but does not exist`);
    failed++;
    continue;
  }
  const r = spawnSync("node", [script], {
    stdio: "inherit",
    env: { ...process.env, NODE_V8_COVERAGE: TMP_DIR },
  });
  if (r.status !== 0) {
    console.error(`✗ FAIL  ${script}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\ncoverage: ${failed} selftest(s) failed — not writing a report.`);
  process.exit(1);
}

// c8 reads the raw V8 profiles NODE_V8_COVERAGE just wrote. `all` counts scripts
// the suite never loaded, so an untested file reads as 0% instead of vanishing.
const report = spawnSync(
  "npx",
  [
    "c8",
    "report",
    "--temp-directory",
    TMP_DIR,
    "--reports-dir",
    COVERAGE_DIR,
    "--reporter=lcov",
    "--reporter=text-summary",
    "--all",
    "--include",
    "scripts/**/*.mjs",
    "--exclude",
    "scripts/*-selftest.mjs",
    "--exclude",
    "scripts/coverage.mjs",
  ],
  { stdio: "inherit" },
);

if (report.status !== 0) {
  console.error("✗ c8 report failed");
  process.exit(1);
}
console.log(`\n✓ coverage written to ${COVERAGE_DIR}/lcov.info`);
