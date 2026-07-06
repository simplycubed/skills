// snapshot-selftest.mjs
//
// Hermetic (no-network) test of the materializeUnit seam: it returns the LOCAL unit
// when present and re-hashes it, and it throws FAIL-CLOSED when the manifest hash
// doesn't match. Uses a SYNTHETIC temp snapshot (via the snapDir option) rather than
// a committed unit, so it keeps working after PR-7 deletes the in-git unit bytes. The
// R2 source path is exercised separately by CI's SKILLS_FORCE_R2 run (live CDN).
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { materializeUnit, contentHash } from "./snapshot.mjs";

let ok = true;
const check = (label, fn) => {
  try { fn(); console.log(`✓ ${label}`); } catch (e) { ok = false; console.log(`✗ ${label}: ${e.message}`); }
};

// Build a synthetic snapshot: <tmp>/<slug>/unit/<files>, then its true content hash.
const snapDir = mkdtempSync(join(tmpdir(), "snap-selftest-"));
const slug = "t";
const unit = join(snapDir, slug, "unit");
mkdirSync(join(unit, "references"), { recursive: true });
writeFileSync(join(unit, "SKILL.md"), "---\nname: t\ndescription: d\n---\n# Body\n");
writeFileSync(join(unit, "references", "a.md"), "alpha\n");
const good = contentHash(unit);

check("materializeUnit returns the local unit and its hash matches the manifest", () => {
  const m = materializeUnit(slug, { contentHash: good }, { snapDir });
  try {
    assert.equal(m.source, "local");
    assert.equal(contentHash(m.dir), good);
  } finally {
    m.cleanup();
  }
});

check("materializeUnit throws fail-closed on a manifest hash mismatch", () => {
  const bad = { contentHash: "sha256:" + "0".repeat(64) };
  assert.throws(() => { const m = materializeUnit(slug, bad, { snapDir }); m.cleanup(); }, /!= manifest/);
});

rmSync(snapDir, { recursive: true, force: true });

if (!ok) { console.error("✗ snapshot self-test FAILED"); process.exit(1); }
console.log("✓ snapshot self-test passed (materializeUnit: local source + fail-closed on drift)");
