// bloat-guard.mjs — refuse to let snapshot UNIT bytes back into git history.
//
// After PR-7 the unit bytes live only in R2 (content-addressed); git keeps just the
// tiny snapshots/<slug>/manifest.json trust anchors. Re-committing a snapshots/*/unit
// tree would reintroduce the exact GB-scale history bloat the migration removed — and
// every clone would carry it forever. This gate fails if any such file is tracked.
import { execSync } from "node:child_process";

const tracked = execSync("git ls-files -- snapshots", { encoding: "utf8" })
  .split("\n")
  .filter((p) => /(^|\/)unit(\/|$)/.test(p));

if (tracked.length) {
  console.error("✗ bloat-guard: snapshot unit bytes must NOT be committed (they live in R2):");
  for (const p of tracked) console.error(`    ${p}`);
  console.error("  Keep only snapshots/<slug>/manifest.json in git.");
  process.exit(1);
}
console.log("✓ bloat-guard: no snapshot unit bytes tracked in git");
