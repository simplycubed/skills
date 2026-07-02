// revoke-selftest.mjs
//
// Proves revocation actually pulls a skill: a revoked skill must be ABSENT from
// both catalog.json and marketplace.json, and revoke() must flip the config
// status and remove the snapshot. Hermetic — operates on temp dirs.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readActiveSkills, buildMarketplace, buildCatalog } from "./generate.mjs";
import { revoke } from "./revoke.mjs";

const cfg = (slug, status) => `slug: ${slug}
name: ${slug}
description: test skill
version: 1.0.0
status: ${status}
upstream:
  repo: acme/${slug}
  sha: "${"a".repeat(40)}"
author:
  name: Acme
license: MIT
`;

const skills = mkdtempSync(join(tmpdir(), "revoke-skills-"));
writeFileSync(join(skills, "keep.yaml"), cfg("keep", "active"));
writeFileSync(join(skills, "gone.yaml"), cfg("gone", "revoked"));

// A revoked skill is excluded from publication → absent from both manifests.
const active = readActiveSkills(skills);
assert.deepEqual(active.map((s) => s.slug), ["keep"], "only active skills are published");
const mkt = buildMarketplace(active);
const cat = buildCatalog(active, () => null);
assert.ok(!mkt.plugins.some((p) => p.name === "gone"), "revoked skill absent from marketplace.json");
assert.ok(!cat.skills.some((s) => s.slug === "gone"), "revoked skill absent from catalog.json");
console.log("✓ revoked skills are absent from catalog.json + marketplace.json");

// revoke() flips status and removes the snapshot.
const skills2 = mkdtempSync(join(tmpdir(), "revoke-skills2-"));
const snaps2 = mkdtempSync(join(tmpdir(), "revoke-snaps2-"));
writeFileSync(join(skills2, "victim.yaml"), cfg("victim", "active"));
mkdirSync(join(snaps2, "victim", "unit"), { recursive: true });
writeFileSync(join(snaps2, "victim", "manifest.json"), "{}");

const r = revoke("victim", { write: true, skillsDir: skills2, snapDir: snaps2 });
assert.equal(r.statusSetTo, "revoked");
assert.equal(r.snapshotRemoved, true);
assert.match(readFileSync(join(skills2, "victim.yaml"), "utf8"), /^status:\s*revoked$/m, "config status flipped");
assert.equal(existsSync(join(snaps2, "victim")), false, "snapshot removed");
assert.deepEqual(readActiveSkills(skills2), [], "revoked skill no longer active");
console.log("✓ revoke() flips status + removes snapshot");

console.log("✓ revoke self-test passed");
