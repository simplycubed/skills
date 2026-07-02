// gate-selftest.mjs
//
// Proves the certification gate actually discriminates: the clean fixture must
// PASS and the dirty fixture must FAIL. A gate never seen to fire is a
// false-clear, so this runs in CI on every PR (and locally via `pnpm gate:selftest`).
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const certify = join(root, "scripts/certify.mjs");

function run(dir) {
  const r = spawnSync(process.execPath, [certify, join(root, dir)], { encoding: "utf8" });
  return r.status;
}

const cases = [
  { dir: "fixtures/clean-skill", expect: 0, label: "clean fixture passes" },
  { dir: "fixtures/dirty-skill", expect: 1, label: "dirty fixture is blocked" },
];

let ok = true;
for (const c of cases) {
  const status = run(c.dir);
  const pass = status === c.expect;
  if (!pass) ok = false;
  console.log(`${pass ? "✓" : "✗"} ${c.label} (exit ${status}, expected ${c.expect})`);
}

if (!ok) {
  console.error("✗ gate self-test FAILED: the certifier does not discriminate as expected");
  process.exit(1);
}
console.log("✓ gate self-test passed");
