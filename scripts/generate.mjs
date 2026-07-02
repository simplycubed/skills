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
const CATALOG_SCHEMA_VERSION = 1;

// Where an agent drops a skill folder, mirroring the README install table. Every
// listed skill is a plain SKILL.md folder, so it installs into any compatible
// agent; the vendor-neutral .agents/skills/ path is what Codex and Gemini CLI
// read directly.
const INSTALL_TARGETS = [
  { agent: "Vendor-neutral (Codex, Gemini CLI, …)", dir: ".agents/skills/" },
  { agent: "Claude Code", dir: "~/.claude/skills/" },
  { agent: "Gemini CLI", dir: "~/.gemini/skills/" },
];

// Browsable source of the exact published folder, pinned to the certified SHA.
function folderSourceUrl(c) {
  const base = `https://github.com/${c.upstream.repo}/tree/${c.upstream.sha}`;
  return c.upstream.path ? `${base}/${c.upstream.path}` : base;
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
export function pluginEntry(c) {
  const source = c.upstream.path
    ? { source: "git-subdir", url: `https://github.com/${c.upstream.repo}.git`, path: c.upstream.path, sha: c.upstream.sha }
    : { source: "github", repo: c.upstream.repo, sha: c.upstream.sha };
  const entry = {
    name: c.slug,
    description: c.description,
    version: c.version,
    author: c.author.url ? { name: c.author.name, url: c.author.url } : { name: c.author.name },
    license: c.license,
    homepage: c.homepage || `https://github.com/${c.upstream.repo}`,
    source,
  };
  if (c.category) entry.category = c.category;
  if (c.tags && c.tags.length) entry.keywords = c.tags;
  return entry;
}

export function buildMarketplace(configs) {
  return {
    $schema: "https://anthropic.com/claude-code/marketplace.schema.json",
    name: MARKETPLACE_NAME,
    description: "SimplyCubed certified Agent Skills — scanned and verified. https://simplycubed.com/skills",
    owner: OWNER,
    plugins: configs.map(pluginEntry),
  };
}

export function catalogEntry(c, scan) {
  return {
    slug: c.slug,
    name: c.name,
    description: c.description,
    version: c.version,
    category: c.category || null,
    tags: c.tags || [],
    author: c.author,
    license: c.license,
    upstream: c.upstream,
    sourceUrl: c.homepage || `https://github.com/${c.upstream.repo}`,
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
      ? { status: scan.passed ? "certified" : "revoked", scannedAt: scan.scanned_at || null, record: scan }
      : { status: "pending", scannedAt: null, record: null },
  };
}

export function buildCatalog(configs, scanFor = readScan) {
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    marketplace: MARKETPLACE_NAME,
    skills: configs.map((c) => catalogEntry(c, scanFor(c.slug))),
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
