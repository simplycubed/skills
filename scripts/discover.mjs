// discover.mjs — top-of-funnel SOURCE DISCOVERY.
//
// Finds candidate Agent Skills across public GitHub by locating `SKILL.md` files
// (the open, cross-tool Agent Skill format) via the authenticated `gh` CLI, then
// enriches each unique source repo with the metadata the ingestion funnel needs:
//   { repo, sha, path, license, sourceUrl }
// where `sha` is pinned to the repo's CURRENT default-branch HEAD (so a later
// fetch is byte-stable), `path` is the skill DIRECTORY (matching catalog's
// `upstream.path` convention — NOT the SKILL.md file), and `license` is the SPDX
// id from the GitHub repo object.
//
// This is discovery ONLY — no license filter, no dedup (that is phase1's job).
// It casts a wide net across MANY source repos, not just github/awesome-copilot.
//
// Mechanics + rate limits:
//   - `gh search code --filename=SKILL.md <anchor>` — GitHub code search needs a
//     keyword, so we run several ANCHOR terms that recur in SKILL.md frontmatter
//     ("description", "license", "when to use", …) to diversify coverage. Code
//     search is rate-limited (~10/min) and caps at ~1000 results, so we keep a
//     modest per-anchor limit and dedup (repo,path) pairs across anchors.
//   - Enrichment (`repos/{owner}/{repo}` for license+default_branch, then
//     `commits/HEAD` for the pinned sha) runs ONCE PER UNIQUE REPO — the core API
//     is 5000/hr, so dedup-before-enrich keeps us well inside budget.
//   - Fail-soft: a 404 / empty repo / missing field drops that one candidate with
//     a reason and never aborts the run.
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// Frontmatter/body terms that recur across SKILL.md files. Variety is the only
// lever we have for "many source repos, not just awesome-copilot", so spread the
// anchors across the fields a well-formed skill tends to carry.
export const DEFAULT_ANCHORS = [
  "description",
  "license",
  "when to use this skill",
  "allowed-tools",
  "instructions",
  "you should",
  "examples",
  "capabilities",
];

const PER_ANCHOR_LIMIT = 60;

function gh(args) {
  const r = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    const msg = (r.stderr || r.stdout || `exit ${r.status}`).trim();
    const err = new Error(msg);
    err.status = r.status;
    return { ok: false, err };
  }
  return { ok: true, out: r.stdout };
}

// Normalize a discovered SKILL.md file path to its skill DIRECTORY, matching
// catalog's `upstream.path` convention (which stores the dir, not the file):
//   "skills/foo/SKILL.md"        -> "skills/foo"
//   "SKILL.md"                   -> ""            (repo root)
//   ".claude/skills/bar/SKILL.md"-> ".claude/skills/bar"
// Returns "" for a root-level SKILL.md so the dedup key mirrors an empty
// upstream.path. Callers treat "" and null/undefined as the same (root).
export function skillDir(filePath) {
  const p = String(filePath).replace(/^\/+/, "");
  const m = p.match(/^(.*?)\/?SKILL\.md$/i);
  if (!m) return p; // unexpected shape — keep as-is rather than lose the candidate
  return m[1].replace(/\/+$/, "");
}

// Run one anchored code search, return raw {repository, path} hits (or [] on error).
function searchAnchor(anchor, limit) {
  const r = gh([
    "search", "code", "--filename=SKILL.md", anchor,
    "--limit", String(limit),
    "--json", "repository,path",
  ]);
  if (!r.ok) {
    console.error(`  ! search "${anchor}" failed: ${r.err.message.split("\n")[0]}`);
    return [];
  }
  try { return JSON.parse(r.out); } catch { return []; }
}

// Collect unique (repo, dirPath) candidate pairs across all anchors. Skips forks.
export function collectCandidatePairs({ anchors = DEFAULT_ANCHORS, perAnchorLimit = PER_ANCHOR_LIMIT } = {}) {
  const seen = new Map(); // "repo#dir" -> { repo, path }
  for (const anchor of anchors) {
    const hits = searchAnchor(anchor, perAnchorLimit);
    for (const h of hits) {
      const repo = h?.repository?.nameWithOwner;
      if (!repo) continue;
      if (h.repository.isFork) continue; // forks re-surface upstream; skip
      const dir = skillDir(h.path);
      const key = `${repo}#${dir}`;
      if (!seen.has(key)) seen.set(key, { repo, path: dir });
    }
  }
  return [...seen.values()];
}

// Enrich one repo: current default-branch HEAD sha + SPDX license id. Cached per
// repo by the caller. Returns null on any failure (fail-soft).
export function enrichRepo(repo, cache = new Map()) {
  if (cache.has(repo)) return cache.get(repo);
  let result = null;
  const meta = gh(["api", `repos/${repo}`, "--jq", "{spdx: .license.spdx_id, default_branch: .default_branch, archived: .archived}"]);
  if (meta.ok) {
    let m;
    try { m = JSON.parse(meta.out); } catch { m = null; }
    if (m) {
      const head = gh(["api", `repos/${repo}/commits/HEAD`, "--jq", ".sha"]);
      const sha = head.ok ? head.out.trim() : null;
      if (sha) result = { license: m.spdx || null, sha, archived: !!m.archived };
    }
  }
  cache.set(repo, result);
  return result;
}

// Full discovery: pairs -> enriched candidates. Emits the funnel record shape.
export function discover(opts = {}) {
  const pairs = collectCandidatePairs(opts);
  const repoCache = new Map();
  const candidates = [];
  const dropped = [];
  for (const { repo, path } of pairs) {
    const meta = enrichRepo(repo, repoCache);
    if (!meta) { dropped.push({ repo, path, reason: "repo metadata unavailable (404/empty/rate)" }); continue; }
    const sourceUrl = path
      ? `https://github.com/${repo}/tree/${meta.sha}/${path}`
      : `https://github.com/${repo}/tree/${meta.sha}`;
    candidates.push({
      repo,
      sha: meta.sha,
      path: path || null,
      license: meta.license,
      archived: meta.archived,
      sourceUrl,
    });
  }
  return { candidates, dropped, pairCount: pairs.length };
}

function main() {
  const anchors = process.argv.includes("--quick") ? DEFAULT_ANCHORS.slice(0, 3) : DEFAULT_ANCHORS;
  console.error(`discover: searching SKILL.md across ${anchors.length} anchors…`);
  const { candidates, dropped, pairCount } = discover({ anchors });
  console.error(`discover: ${pairCount} unique (repo,path) pairs → ${candidates.length} enriched, ${dropped.length} dropped`);
  process.stdout.write(JSON.stringify(candidates, null, 2) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
