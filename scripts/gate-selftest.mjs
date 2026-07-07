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
  let verdict = null;
  try { verdict = JSON.parse(r.stdout); } catch { /* non-JSON on usage error */ }
  return { status: r.status, verdict };
}

const cases = [
  { dir: "fixtures/clean-skill", expect: 0, label: "clean fixture passes" },
  { dir: "fixtures/dirty-skill", expect: 1, label: "dirty fixture is blocked" },
  // REVIEW-tier vocabulary (defensive security guidance) must PASS but be surfaced,
  // not auto-failed — the behaviour that lets legitimate security skills through.
  { dir: "fixtures/review-skill", expect: 0, label: "review-only fixture passes with findings surfaced",
    review: true },
  // Bidi "Trojan Source" obfuscation must BLOCK (folded into the injection tier).
  { dir: "fixtures/obfuscated-skill", expect: 1, label: "bidi-obfuscated fixture is blocked",
    obfuscation: true },
  // An install-time lifecycle hook must PASS but be surfaced as review, not blocked.
  { dir: "fixtures/install-hook-skill", expect: 0, label: "install-hook fixture passes with the hook surfaced",
    installHook: true },
  // "Posting secrets to a remote" is negation-aware: a DEFENSIVE mention passes (review),
  // an INSTRUCTION to exfiltrate blocks. Guards against false-positives on security skills.
  { dir: "fixtures/exfil-defensive", expect: 0, label: "defensive POST-secret mention passes (surfaced)",
    review: true },
  { dir: "fixtures/exfil-malicious", expect: 1, label: "malicious POST-secret instruction is blocked",
    exfilBlock: true },
];

let ok = true;
for (const c of cases) {
  const { status, verdict } = run(c.dir);
  let pass = status === c.expect;
  if (c.review) {
    const surfaced = verdict && verdict.finding_count === 0 && verdict.review_count > 0;
    pass = pass && surfaced;
    console.log(`${pass ? "✓" : "✗"} ${c.label} (exit ${status}, review_count ${verdict?.review_count})`);
  } else if (c.obfuscation) {
    // Must block for the RIGHT reason — a bidi finding in the injection tier.
    const flagged = (verdict?.checks?.injection || []).some((s) => /bidirectional override/i.test(s));
    pass = pass && flagged;
    console.log(`${pass ? "✓" : "✗"} ${c.label} (exit ${status}, bidi flagged ${flagged})`);
  } else if (c.installHook) {
    // Must pass, with the install hook surfaced (not blocked).
    const flagged = verdict && verdict.finding_count === 0 && (verdict.review || []).some((s) => /lifecycle script/i.test(s));
    pass = pass && flagged;
    console.log(`${pass ? "✓" : "✗"} ${c.label} (exit ${status}, hook flagged ${flagged})`);
  } else if (c.exfilBlock) {
    // Must block for the RIGHT reason — a posting-secrets finding in the injection tier.
    const flagged = (verdict?.checks?.injection || []).some((s) => /posting secrets to a remote/i.test(s));
    pass = pass && flagged;
    console.log(`${pass ? "✓" : "✗"} ${c.label} (exit ${status}, exfil blocked ${flagged})`);
  } else {
    console.log(`${pass ? "✓" : "✗"} ${c.label} (exit ${status}, expected ${c.expect})`);
  }
  if (!pass) ok = false;
}

if (!ok) {
  console.error("✗ gate self-test FAILED: the certifier does not discriminate as expected");
  process.exit(1);
}
console.log("✓ gate self-test passed");
