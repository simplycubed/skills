// generate.mjs [--check]
//
// Generates the two committed, machine-readable manifests from config/skills/*.yaml:
//   - .claude-plugin/marketplace.json  (Claude Code reads this on `/plugin marketplace add`)
//   - catalog.json                     (the storefront reads this; badge source of truth)
//
// Default: write both files. With --check: regenerate in memory and fail (exit 1)
// if the committed files differ — the CI "no-drift" gate, so a hand-edited or
// stale manifest can't ship.
//
// Only status:active skills are published. Certification comes from each skill's
// <slug>.scan.json (produced by the certification step); absent = "pending".
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "config/skills");
const MARKETPLACE_NAME = "simplycubed";
const OWNER = { name: "SimplyCubed", url: "https://simplycubed.com" };
const MARKETPLACE_PATH = join(ROOT, ".claude-plugin/marketplace.json");
const CATALOG_PATH = join(ROOT, "catalog.json");

// Bump when catalog.json's shape changes in a way consumers (the storefront)
// must adapt to. Validated against config/catalog.schema.json in CI.
// v3: `version` is now string|null — the UPSTREAM-declared version at the pinned
// SHA, or null for an "unversioned" skill (upstream declares none). The storefront
// sorts unversioned skills by certification.scannedAt.
const CATALOG_SCHEMA_VERSION = 3;

// Where an agent drops a skill folder, mirroring the README install table. Every
// listed skill is a plain SKILL.md folder, so it installs into any compatible
// agent; the vendor-neutral .agents/skills/ path is what Codex and Gemini CLI
// read directly.
const INSTALL_TARGETS = [
  { agent: "Vendor-neutral (Codex, Gemini CLI, …)", dir: ".agents/skills/" },
  { agent: "Claude Code", dir: "~/.claude/skills/" },
  { agent: "Gemini CLI", dir: "~/.gemini/skills/" },
];

// Source of the exact published folder. Points at our durable, content-addressed
// snapshot in R2 (the CDN tarball), so the folder stays available and byte-stable
// even if the upstream repo disappears — and survives PR-7 deleting the in-git unit
// bytes. It is a `.tar.gz` (download + extract), NOT a browsable tree — a UX change
// the storefront must adopt at schemaVersion 2. Falls back to the pinned upstream
// tree only for a skill with no snapshot manifest (not normally published).
export function folderSource(c, hex) {
  if (hex) return `https://cdn.simplycubed.com/blobs/sha256/${hex}/unit.tar.gz`;
  const path = c.upstream.path ? `/${c.upstream.path}` : "";
  return `https://github.com/${c.upstream.repo}/tree/${c.upstream.sha}${path}`;
}

// The content hash from a skill's committed snapshot manifest (which PR-7 keeps),
// used to build the content-addressed CDN URL. null if not yet snapshotted.
function contentHexOf(slug) {
  const p = join(ROOT, "snapshots", slug, "manifest.json");
  if (!existsSync(p)) return null;
  try { return String(JSON.parse(readFileSync(p, "utf8")).contentHash).replace(/^sha256:/, ""); }
  catch { return null; }
}

function folderSourceUrl(c) {
  return folderSource(c, contentHexOf(c.slug));
}

// The upstream-declared version from a skill's committed snapshot manifest — the
// single source of truth for a listing's version. null when the skill declares no
// version ("unversioned"): the catalog emits version:null and the plugin manifest
// omits version entirely (Claude Code then falls back to the commit SHA for update
// detection). A manifest predating this field (no upstreamVersion key) also reads
// as null. Enforced strict-semver by versions:check; the catalog schema rejects a
// non-semver string, so a bad value can't ship.
export function upstreamVersionOf(slug) {
  const p = join(ROOT, "snapshots", slug, "manifest.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")).upstreamVersion ?? null; }
  catch { return null; }
}

// Deep link to a pre-filled GitHub issue form for authors/rights-holders to
// request removal of their skill. Pre-fills the slug + upstream; the form
// collects ownership proof (see .github/ISSUE_TEMPLATE/skill-removal.yml).
function removalUrl(c) {
  const q = new URLSearchParams({
    template: "skill-removal.yml",
    title: `Remove skill: ${c.slug}`,
    skill: c.slug,
    upstream: c.upstream.repo,
  });
  return `https://github.com/${MARKETPLACE_NAME}/skills/issues/new?${q}`;
}

// Clean a description for display. Skill descriptions (often lifted from upstream
// SKILL.md frontmatter) can contain markup-like noise — most commonly
// angle-bracket placeholders such as "LL <n>" — that render as broken tags or
// literal junk in the storefront. Strip angle brackets, normalize whitespace,
// and remove any space left dangling before punctuation or a closing quote.
// Runs at generation time on every published description.
export function sanitizeDescription(desc) {
  return String(desc ?? "")
    .replace(/<([^<>]*)>/g, "$1")   // "<n>" -> "n" (drop the tag-like brackets, keep content)
    .replace(/[<>]/g, "")           // any remaining stray angle brackets
    .replace(/\s{2,}/g, " ")        // collapse doubled whitespace
    .replace(/\s+([,.;:!?])/g, "$1") // no space before punctuation
    .trim();
}

export function readActiveSkills(dir = SKILLS_DIR) {
  const configs = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .map((f) => yaml.load(readFileSync(join(dir, f), "utf8")))
    .filter((c) => c && c.status === "active");
  return configs.sort((a, b) => a.slug.localeCompare(b.slug));
}

function readScan(slug, dir = SKILLS_DIR) {
  const p = join(dir, `${slug}.scan.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// Map a skill config to a Claude Code marketplace plugin entry.
// Root skills use the "github" source (no subdirectory support); skills in a
// subfolder use "git-subdir". The full commit SHA is the pin in both cases.
export function pluginEntry(c, version = null) {
  const source = c.upstream.path
    ? { source: "git-subdir", url: `https://github.com/${c.upstream.repo}.git`, path: c.upstream.path, sha: c.upstream.sha }
    : { source: "github", repo: c.upstream.repo, sha: c.upstream.sha };
  const entry = {
    name: c.slug,
    description: sanitizeDescription(c.description),
    // OMIT version for an unversioned skill: Claude Code's plugin manifest treats
    // version as optional and falls back to the commit SHA (source.sha) for update
    // detection when it's absent — exactly what we want for a SHA-pinned listing.
    ...(version ? { version } : {}),
    author: c.author.url ? { name: c.author.name, url: c.author.url } : { name: c.author.name },
    license: c.license,
    homepage: c.homepage || `https://github.com/${c.upstream.repo}`,
    source,
  };
  if (c.category) entry.category = c.category;
  if (c.tags && c.tags.length) entry.keywords = c.tags;
  return entry;
}

export function buildMarketplace(configs, versionFor = upstreamVersionOf) {
  return {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: MARKETPLACE_NAME,
    description: "SimplyCubed certified Agent Skills — scanned and verified. https://simplycubed.com/skills",
    owner: OWNER,
    // Only FREE skills go in the public plugin manifest — premium skills are
    // gated (a paid skill can't be freely installable from a public marketplace).
    plugins: configs
      .filter((c) => (c.tier || "free") === "free")
      .map((c) => pluginEntry(c, versionFor(c.slug))),
  };
}

// A scan that skipped a required scanner (incomplete) is NEVER "certified".
function certStatus(scan) {
  if (scan.incomplete) return "incomplete";
  return scan.passed ? "certified" : "revoked";
}

export function catalogEntry(c, scan, version = null) {
  return {
    slug: c.slug,
    name: c.name,
    description: sanitizeDescription(c.description),
    // The upstream-declared version at the pinned SHA, or null when unversioned.
    // Never a fabricated default — a null here tells the storefront to sort this
    // skill by certification.scannedAt instead of a version.
    version,
    category: c.category || null,
    tags: c.tags || [],
    author: c.author,
    license: c.license,
    upstream: c.upstream,
    sourceUrl: c.homepage || `https://github.com/${c.upstream.repo}`,
    tier: c.tier || "free", // "free" | "premium" — the seam for subscription-gated skills
    removalUrl: removalUrl(c), // author/rights-holder "request removal" deep link


    install: {
      // Claude Code one-command install via the plugin marketplace.
      claudeCode: {
        marketplaceAdd: `/plugin marketplace add ${MARKETPLACE_NAME}/skills`,
        command: `/plugin install ${c.slug}@${MARKETPLACE_NAME}`,
      },
      // Vendor-neutral: drop the skill folder into any agent's skills directory.
      folder: {
        dirName: c.slug,
        source: folderSourceUrl(c),
        targets: INSTALL_TARGETS,
      },
    },
    certification: scan
      ? { status: certStatus(scan), scannedAt: scan.scanned_at || null, record: scan }
      : { status: "pending", scannedAt: null, record: null },
  };
}

export function buildCatalog(configs, scanFor = readScan, versionFor = upstreamVersionOf) {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    marketplace: MARKETPLACE_NAME,
    skills: configs.map((c) => catalogEntry(c, scanFor(c.slug), versionFor(c.slug))),
  };
}

function serialize(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

function main() {
  const check = process.argv.includes("--check");
  const configs = readActiveSkills();
  const outputs = [
    [MARKETPLACE_PATH, serialize(buildMarketplace(configs))],
    [CATALOG_PATH, serialize(buildCatalog(configs))],
  ];

  if (check) {
    let drift = false;
    for (const [path, content] of outputs) {
      const current = existsSync(path) ? readFileSync(path, "utf8") : "";
      if (current !== content) {
        drift = true;
        console.error(`✗ drift: ${path.replace(ROOT + "/", "")} is out of date — run \`pnpm generate\``);
      }
    }
    if (drift) process.exit(1);
    console.log(`✓ manifests match config (${configs.length} active skill(s))`);
    return;
  }

  mkdirSync(dirname(MARKETPLACE_PATH), { recursive: true });
  for (const [path, content] of outputs) writeFileSync(path, content);
  console.log(`✓ generated marketplace.json + catalog.json (${configs.length} active skill(s))`);
}

// Run only when executed directly, so the self-test can import the build functions
// without triggering file writes.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
