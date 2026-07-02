// certify-active.mjs
//
// CI's fail-closed integrity gate. Independently re-runs the full scanner suite
// over every status:active skill's committed SNAPSHOT (no upstream fetch) and
// fails if any skill's verdict isn't a pass. This stops a hand-edited
// <slug>.scan.json from smuggling a failing skill into the catalog — the
// committed record is the display copy, but merge requires the live re-scan to
// pass — and, because it reads the snapshot, certification stays green even if
// the upstream repo disappears.
import { readActiveSkills } from "./generate.mjs";
import { scanSnapshot } from "./scan.mjs";

const skills = readActiveSkills();
if (skills.length === 0) {
  console.log("no active skills to certify");
  process.exit(0);
}

let ok = true;
for (const cfg of skills) {
  let r;
  try {
    r = scanSnapshot(cfg.slug);
  } catch (e) {
    ok = false;
    console.log(`✗ ${cfg.slug}: scan threw — ${e.message}`);
    continue;
  }
  console.log(`${r.passed ? "✓" : "✗"} ${cfg.slug}: ${r.finding_count} blocking, ${r.review_count} review [${Object.keys(r.tools).join(", ")}]`);
  if (!r.passed) {
    ok = false;
    if (r.scan_errors.length) console.log(`    scan errors: ${r.scan_errors.join("; ")}`);
    for (const [k, v] of Object.entries(r.checks)) if (v.length) console.log(`    ${k}: ${v.join(", ")}`);
  }
}

if (!ok) { console.error("✗ certify-active FAILED: an active skill did not pass re-verification"); process.exit(1); }
console.log(`✓ all ${skills.length} active skill(s) re-verified`);
