// versions-selftest.mjs
//
// Proves the version gate's classification: strict semver is accepted, a missing
// version is a legitimate "unversioned" pass, and a declared-but-non-semver value
// is rejected (never silently dropped or coerced).
import assert from "node:assert/strict";
import { classifyVersion, SEMVER } from "./versions-check.mjs";
import { skillVersion } from "./snapshot.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let ok = true;
const check = (label, fn) => {
  try { fn(); console.log(`✓ ${label}`); } catch (e) { ok = false; console.log(`✗ ${label}: ${e.message}`); }
};

// --- classifyVersion ---
check("strict semver is accepted and surfaced verbatim", () => {
  assert.deepEqual(classifyVersion("2.8.2"), { ok: true, version: "2.8.2" });
  assert.deepEqual(classifyVersion("10.0.14"), { ok: true, version: "10.0.14" });
});
check("null / undefined is a legitimate 'unversioned' pass", () => {
  assert.deepEqual(classifyVersion(null), { ok: true, unversioned: true });
  assert.deepEqual(classifyVersion(undefined), { ok: true, unversioned: true });
});
check("declared-but-non-semver is rejected (not dropped, not coerced)", () => {
  for (const bad of ["v2.0.0", "2.8", "1.2.3-beta", "1.2", "latest", "2.8.2.1"]) {
    const r = classifyVersion(bad);
    assert.equal(r.ok, false, `${bad} must be rejected`);
    assert.match(r.reason, /non-semver/);
  }
});
check("SEMVER matches only strict X.Y.Z", () => {
  assert.ok(SEMVER.test("0.0.1"));
  assert.ok(!SEMVER.test("v1.0.0"));
  assert.ok(!SEMVER.test("1.0"));
});

// --- skillVersion: parse the version out of SKILL.md frontmatter ---
const dir = mkdtempSync(join(tmpdir(), "ver-selftest-"));
const writeSkill = (body) => { const u = join(dir, "unit"); rmSync(u, { recursive: true, force: true }); mkdirSync(u, { recursive: true }); writeFileSync(join(u, "SKILL.md"), body); return u; };

check("skillVersion reads a quoted frontmatter version", () => {
  const u = writeSkill('---\nname: h\nversion: "2.8.2"\n---\n# Body\nversion: 9.9.9 in prose\n');
  assert.equal(skillVersion(u), "2.8.2");
});
check("skillVersion reads an unquoted frontmatter version", () => {
  const u = writeSkill("---\nname: h\nversion: 3.0.0\n---\nbody\n");
  assert.equal(skillVersion(u), "3.0.0");
});
check("skillVersion returns null when frontmatter has no version", () => {
  const u = writeSkill("---\nname: h\ndescription: d\n---\nbody\n");
  assert.equal(skillVersion(u), null);
});
check("skillVersion returns null when there is no frontmatter block", () => {
  const u = writeSkill("# Just a heading\nversion: 1.2.3 in body only\n");
  assert.equal(skillVersion(u), null);
});
check("skillVersion returns null when SKILL.md is absent", () => {
  const u = join(dir, "empty"); mkdirSync(u, { recursive: true });
  assert.equal(skillVersion(u), null);
});

rmSync(dir, { recursive: true, force: true });

if (!ok) { console.error("✗ versions self-test FAILED"); process.exit(1); }
console.log("✓ versions self-test passed (classify + SKILL.md frontmatter parse)");
