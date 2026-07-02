// certify-active.mjs
//
// CI's fail-closed integrity gate. Independently re-runs the full fetch-and-scan
// over every status:active skill (fresh fetch at the pinned SHA + all scanner
// tiers) and fails if any skill's LIVE verdict isn't a pass. This is what stops
// a hand-edited <slug>.scan.json from smuggling a failing skill into the
// catalog: the committed record is the display copy, but merge requires the
// scan to still pass here on the real upstream bytes.
import { readActiveSkills } from "./generate.mjs";
import { scan } from "./scan.mjs";

const skills = readActiveSkills();
if (skills.length === 0) {
  console.log("no active skills to certify");
  process.exit(0);
}

let ok = true;
for (const cfg of skills) {
  let r;
  try {
    r = scan(cfg.slug);
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
