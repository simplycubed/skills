// snapshot-selftest.mjs
//
// Hermetic (no-network) test of the materializeUnit seam: it returns the LOCAL unit
// when present and re-hashes it, and it throws FAIL-CLOSED when the manifest hash
// doesn't match. The R2 source path is exercised separately by CI's SKILLS_FORCE_R2
// run (which needs the live CDN); here we only need the local + fail-closed branches.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readActiveSkills } from "./generate.mjs";
import { readManifest, materializeUnit, contentHash, SNAP_DIR } from "./snapshot.mjs";

let ok = true;
const check = (label, fn) => {
  try { fn(); console.log(`✓ ${label}`); } catch (e) { ok = false; console.log(`✗ ${label}: ${e.message}`); }
};

const withLocal = readActiveSkills().find((c) => existsSync(join(SNAP_DIR, c.slug, "unit")));
assert(withLocal, "self-test needs at least one skill with a committed local unit");
const slug = withLocal.slug;
const manifest = readManifest(slug);

check("materializeUnit returns the local unit and its hash matches the manifest", () => {
  const m = materializeUnit(slug, manifest);
  try {
    assert.equal(m.source, "local");
    assert.equal(contentHash(m.dir), manifest.contentHash);
  } finally {
    m.cleanup();
  }
});

check("materializeUnit throws fail-closed on a manifest hash mismatch", () => {
  const bad = { ...manifest, contentHash: "sha256:" + "0".repeat(64) };
  assert.throws(() => { const m = materializeUnit(slug, bad); m.cleanup(); }, /!= manifest/);
});

if (!ok) { console.error("✗ snapshot self-test FAILED"); process.exit(1); }
console.log("✓ snapshot self-test passed (materializeUnit: local source + fail-closed on drift)");
