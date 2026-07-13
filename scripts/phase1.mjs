// phase1.mjs — Phase-1 provenance / license / dedup GATE.
//
// Takes discover.mjs's candidate records and keeps only those that are:
//   1. PERMISSIVELY LICENSED — SPDX id in the same allowlist the skill schema
//      enforces (MIT / Apache-2.0 / BSD-2/3-Clause / ISC / 0BSD / Unlicense /
//      Zlib). Fail-CLOSED: null / "NOASSERTION" / unknown / copyleft → rejected.
//   2. NOT ALREADY INGESTED — deduped against the live catalog.json by the
//      (repo, skill-directory) key. catalog stores `upstream.path` as the skill
//      DIRECTORY, and discover.mjs already normalizes SKILL.md → its directory,
//      so the keys line up. (A repo+path already in the catalog is skipped even
//      if upstream HEAD has moved — we don't re-ingest an existing slug here.)
//
// Optional (flag `--content-hash`, default OFF): fetch each surviving candidate's
// raw SKILL.md and sha256 it for FINER dedup — catches the same skill mirrored
// under a different repo/path. Off by default because it costs one fetch per
// candidate; repo+path dedup is what the funnel bar requires.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The permissive allowlist — MUST mirror config/skill.schema.json `license` enum.
// Anything not in this set (null, "NOASSERTION", GPL/AGPL/LGPL, MPL, unknown) is
// rejected: fail-closed curation, never auto-keep an ambiguous license.
export const PERMISSIVE_SPDX = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "Zlib",
]);

export const isPermissive = (spdx) => PERMISSIVE_SPDX.has(String(spdx));

// Dedup key: repo + "#" + directory. "" (root) and null/undefined collapse to the
// same empty directory, mirroring an absent upstream.path.
export const dedupKey = (repo, path) => `${repo}#${path || ""}`;

// Build the set of already-ingested (repo,path) keys from the live catalog.
export function ingestedKeys(catalogPath = join(ROOT, "catalog.json")) {
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  const keys = new Set();
  for (const s of catalog.skills || []) {
    const u = s.upstream || {};
    if (u.repo) keys.add(dedupKey(u.repo, u.path));
  }
  return keys;
}

// Fetch + sha256 a candidate's raw SKILL.md at its pinned sha (best-effort).
function contentHashOf(repo, path, sha) {
  const rel = path ? `${path}/SKILL.md` : "SKILL.md";
  const url = `https://raw.githubusercontent.com/${repo}/${sha}/${rel}`;
  const r = spawnSync("curl", ["-sSLf", url], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) return null;
  return "sha256:" + createHash("sha256").update(r.stdout).digest("hex");
}

// The gate. Pure over its inputs (catalog keys injected) so it is unit-testable.
export function phase1(candidates, { ingested = ingestedKeys(), withContentHash = false } = {}) {
  const kept = [];
  const rejectedLicense = [];
  const alreadyIngested = [];
  const seenHashes = new Set(); // finer dedup within this run (content-hash mode)

  for (const c of candidates) {
    if (!isPermissive(c.license)) {
      rejectedLicense.push({ ...c, reason: `non-permissive license: ${c.license ?? "none"}` });
      continue;
    }
    if (ingested.has(dedupKey(c.repo, c.path))) {
      alreadyIngested.push(c);
      continue;
    }
    let contentHash;
    if (withContentHash) {
      contentHash = contentHashOf(c.repo, c.path, c.sha);
      if (contentHash && seenHashes.has(contentHash)) { alreadyIngested.push({ ...c, reason: "duplicate content hash" }); continue; }
      if (contentHash) seenHashes.add(contentHash);
    }
    kept.push(withContentHash ? { ...c, contentHash } : c);
  }

  return {
    kept,
    rejectedLicense,
    alreadyIngested,
    counts: {
      found: candidates.length,
      permissive: candidates.length - rejectedLicense.length,
      newAfterDedup: kept.length,
    },
  };
}

function main() {
  // Reads discover.mjs JSON from stdin (so `discover | phase1` composes), or runs
  // discover itself when stdin is a TTY.
  const withContentHash = process.argv.includes("--content-hash");
  let candidates;
  const stdin = readStdin();
  if (stdin) {
    candidates = JSON.parse(stdin);
  } else {
    // Lazy import to avoid a hard dependency when composing via a pipe.
    throw new Error("phase1: no candidates on stdin. Pipe discover.mjs output in: `node scripts/discover.mjs | node scripts/phase1.mjs`");
  }
  const r = phase1(candidates, { withContentHash });
  process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  console.error(`phase1: found=${r.counts.found} permissive=${r.counts.permissive} new-after-dedup=${r.counts.newAfterDedup}`);
}

function readStdin() {
  try {
    return readFileSync(0, "utf8").trim() || null;
  } catch { return null; }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
