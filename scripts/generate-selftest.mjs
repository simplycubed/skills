// generate-selftest.mjs
//
// Proves the manifest generators emit the correct shapes without committing any
// fake "active" skill: feeds synthetic configs through the pure build functions
// and asserts the Claude Code source object (github vs git-subdir), the install
// strings, and the certification status mapping.
import assert from "node:assert/strict";
import { buildMarketplace, buildCatalog } from "./generate.mjs";

const rootSkill = {
  slug: "root-skill",
  name: "Root Skill",
  description: "A skill at the repo root.",
  version: "1.0.0",
  status: "active",
  upstream: { repo: "acme/root", sha: "a".repeat(40) },
  author: { name: "Acme", url: "https://github.com/acme" },
  license: "MIT",
  category: "coding",
  tags: ["example"],
};

const subSkill = {
  slug: "sub-skill",
  name: "Sub Skill",
  description: "A skill inside a monorepo subdirectory.",
  version: "2.3.4",
  status: "active",
  upstream: { repo: "acme/mono", sha: "b".repeat(40), path: "skills/sub" },
  author: { name: "Acme" },
  license: "Apache-2.0",
};

const configs = [rootSkill, subSkill];

// --- marketplace.json ---
const mkt = buildMarketplace(configs);
assert.equal(mkt.name, "simplycubed", "marketplace name");
assert.equal(mkt.plugins.length, 2, "two plugins");

const root = mkt.plugins.find((p) => p.name === "root-skill");
assert.deepEqual(
  root.source,
  { source: "github", repo: "acme/root", sha: "a".repeat(40) },
  "root skill uses github source with repo+sha, no path"
);
assert.equal(root.version, "1.0.0");
assert.equal(root.license, "MIT");
assert.deepEqual(root.author, { name: "Acme", url: "https://github.com/acme" });
assert.deepEqual(root.keywords, ["example"], "tags map to keywords");

const sub = mkt.plugins.find((p) => p.name === "sub-skill");
assert.deepEqual(
  sub.source,
  { source: "git-subdir", url: "https://github.com/acme/mono.git", path: "skills/sub", sha: "b".repeat(40) },
  "subdir skill uses git-subdir source with url+path+sha"
);

// --- catalog.json ---
const cat = buildCatalog(configs, () => null);
assert.equal(cat.schemaVersion, 1, "catalog carries a schemaVersion");
const catRoot = cat.skills.find((s) => s.slug === "root-skill");
// Claude Code install commands
assert.equal(catRoot.install.claudeCode.marketplaceAdd, "/plugin marketplace add simplycubed/skills");
assert.equal(catRoot.install.claudeCode.command, "/plugin install root-skill@simplycubed");
// Vendor-neutral folder install: source points at our durable snapshot, not upstream
assert.equal(catRoot.install.folder.dirName, "root-skill");
assert.equal(catRoot.install.folder.source, "https://github.com/simplycubed/skills/tree/main/snapshots/root-skill/unit");
assert.ok(catRoot.install.folder.targets.some((t) => t.dir === ".agents/skills/"), "vendor-neutral target present");
// Subdir skill: also snapshot-based (keyed by slug, independent of upstream path)
const catSub = cat.skills.find((s) => s.slug === "sub-skill");
assert.equal(catSub.install.folder.source, "https://github.com/simplycubed/skills/tree/main/snapshots/sub-skill/unit");
assert.equal(catRoot.certification.status, "pending", "no scan record => pending");

// certification maps from a scan record
const certified = buildCatalog([rootSkill], () => ({ passed: true, scanned_at: "2026-07-02" }));
assert.equal(certified.skills[0].certification.status, "certified");
const revoked = buildCatalog([rootSkill], () => ({ passed: false }));
assert.equal(revoked.skills[0].certification.status, "revoked");

console.log("✓ generate self-test passed (source shapes, install strings, certification mapping)");
