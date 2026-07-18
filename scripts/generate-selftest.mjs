// generate-selftest.mjs
//
// Proves the manifest generators emit the correct shapes without committing any
// fake "active" skill: feeds synthetic configs through the pure build functions
// and asserts the Claude Code source object (github vs git-subdir), the install
// strings, and the certification status mapping.
import assert from "node:assert/strict";
import { buildMarketplace, buildCatalog, sanitizeDescription, folderSource } from "./generate.mjs";

// --- description sanitization (strip angle-bracket placeholders like "<n>") ---
assert.equal(sanitizeDescription('Triggers on "LL <n>", or set-rigor.'), 'Triggers on "LL n", or set-rigor.');
assert.equal(sanitizeDescription("plain text"), "plain text", "clean text is unchanged");
assert.ok(!/[<>]/.test(sanitizeDescription("a <b> <c> d")), "no angle brackets survive");
// ...and it is applied through the generators:
{
  const dirty = { slug: "d", name: "D", description: "use <flag> now", version: "1.0.0", status: "active",
    upstream: { repo: "a/b", sha: "a".repeat(40) }, author: { name: "A" }, license: "MIT" };
  assert.equal(buildMarketplace([dirty]).plugins[0].description, "use flag now", "marketplace description sanitized");
  assert.equal(buildCatalog([dirty], () => null).skills[0].description, "use flag now", "catalog description sanitized");
}

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

// Version is DERIVED from upstream (via the snapshot manifest), not from the YAML.
// Inject a resolver: root-skill declares an upstream version; sub-skill is unversioned.
const versionFor = (slug) => (slug === "root-skill" ? "2.8.2" : null);

// --- marketplace.json ---
const mkt = buildMarketplace(configs, versionFor);
assert.equal(mkt.name, "simplycubed", "marketplace name");
assert.equal(mkt.plugins.length, 2, "two plugins");

const root = mkt.plugins.find((p) => p.name === "root-skill");
assert.deepEqual(
  root.source,
  { source: "github", repo: "acme/root", sha: "a".repeat(40) },
  "root skill uses github source with repo+sha, no path"
);
assert.equal(root.version, "2.8.2", "declared upstream version is surfaced verbatim");
assert.equal(root.license, "MIT");
assert.deepEqual(root.author, { name: "Acme", url: "https://github.com/acme" });
assert.deepEqual(root.keywords, ["example"], "tags map to keywords");

const sub = mkt.plugins.find((p) => p.name === "sub-skill");
assert.deepEqual(
  sub.source,
  { source: "git-subdir", url: "https://github.com/acme/mono.git", path: "skills/sub", sha: "b".repeat(40) },
  "subdir skill uses git-subdir source with url+path+sha"
);
// An unversioned skill OMITS version entirely (Claude Code falls back to the commit SHA).
assert.ok(!("version" in sub), "unversioned skill omits version key in the plugin manifest");
// With no upstream version anywhere, no plugin carries a version.
const mktUnver = buildMarketplace(configs, () => null);
assert.ok(mktUnver.plugins.every((p) => !("version" in p)), "all-unversioned => no version keys");

// --- catalog.json ---
// folderSource: CDN tarball when a snapshot hash exists, else the pinned upstream tree
assert.equal(folderSource(rootSkill, "deadbeef"),
  "https://cdn.simplycubed.com/blobs/sha256/deadbeef/unit.tar.gz", "hash => content-addressed CDN tarball");
assert.equal(folderSource(rootSkill, null),
  `https://github.com/acme/root/tree/${"a".repeat(40)}`, "no hash => pinned upstream tree (root)");
assert.equal(folderSource(subSkill, null),
  `https://github.com/acme/mono/tree/${"b".repeat(40)}/skills/sub`, "no hash => pinned upstream tree (subdir)");

const cat = buildCatalog(configs, () => null, versionFor);
assert.equal(cat.schemaVersion, 3, "catalog carries schemaVersion 3");
const catRoot = cat.skills.find((s) => s.slug === "root-skill");
// version is the upstream-declared value, or null when unversioned — never a default.
assert.equal(catRoot.version, "2.8.2", "declared upstream version in catalog");
assert.equal(cat.skills.find((s) => s.slug === "sub-skill").version, null, "unversioned => version null");
// Claude Code install commands
assert.equal(catRoot.install.claudeCode.marketplaceAdd, "/plugin marketplace add simplycubed/skills");
assert.equal(catRoot.install.claudeCode.command, "/plugin install root-skill@simplycubed");
// Vendor-neutral folder install. These synthetic skills have no snapshot manifest,
// so the source falls back to the pinned upstream tree (real skills => CDN tarball).
assert.equal(catRoot.install.folder.dirName, "root-skill");
assert.equal(catRoot.install.folder.source, `https://github.com/acme/root/tree/${"a".repeat(40)}`);
assert.ok(catRoot.install.folder.targets.some((t) => t.dir === ".agents/skills/"), "vendor-neutral target present");
// removal request deep link: pre-fills the issue form with slug + upstream
assert.match(catRoot.removalUrl, /issues\/new\?/, "removalUrl points at a new issue");
assert.match(catRoot.removalUrl, /template=skill-removal\.yml/, "removalUrl selects the removal form");
assert.match(catRoot.removalUrl, /skill=root-skill/, "removalUrl pre-fills the slug");
assert.match(catRoot.removalUrl, /upstream=acme%2Froot/, "removalUrl pre-fills (url-encoded) the upstream repo");
// Subdir skill: also snapshot-based (keyed by slug, independent of upstream path)
const catSub = cat.skills.find((s) => s.slug === "sub-skill");
assert.equal(catSub.install.folder.source, `https://github.com/acme/mono/tree/${"b".repeat(40)}/skills/sub`);
assert.equal(catRoot.certification.status, "pending", "no scan record => pending");

// certification maps from a scan record
const certified = buildCatalog([rootSkill], () => ({ passed: true, scanned_at: "2026-07-02" }));
assert.equal(certified.skills[0].certification.status, "certified");
const revoked = buildCatalog([rootSkill], () => ({ passed: false }));
assert.equal(revoked.skills[0].certification.status, "revoked");
// an incomplete scan (a required scanner was skipped) is NEVER certified
const incomplete = buildCatalog([rootSkill], () => ({ passed: true, incomplete: true }));
assert.equal(incomplete.skills[0].certification.status, "incomplete");

// tier seam: defaults to free; premium is listed in the catalog but EXCLUDED from
// the public plugin manifest (a paid skill can't be freely installable).
assert.equal(buildCatalog([rootSkill], () => null).skills[0].tier, "free", "tier defaults to free");
const premium = { ...rootSkill, slug: "paid-skill", tier: "premium" };
const mixed = buildCatalog([rootSkill, premium], () => null);
assert.equal(mixed.skills.find((s) => s.slug === "paid-skill").tier, "premium", "premium tier surfaced in catalog");
const mktMixed = buildMarketplace([rootSkill, premium]);
assert.ok(!mktMixed.plugins.some((p) => p.name === "paid-skill"), "premium skill excluded from public plugin manifest");
assert.ok(mktMixed.plugins.some((p) => p.name === "root-skill"), "free skill still in plugin manifest");

console.log("✓ generate self-test passed (source shapes, install strings, certification mapping)");
