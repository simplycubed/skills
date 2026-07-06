// snapshot.mjs <slug> [--write]
//
// Vendors the certified published unit into snapshots/<slug>/ so certification
// and install no longer depend on the upstream repo staying alive — fulfilling
// the README's "available even if upstream disappears" promise.
//
// Content-addressed: manifest.json records the upstream {repo, sha} and a
// sha256 over the exact unit bytes; snapshot:check re-derives that hash to catch
// drift or tampering. The snapshot is created ONCE from the upstream at its
// pinned SHA (the point of trust); re-verification thereafter reads the snapshot,
// never the network.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { loadConfig, assembleUnit } from "./fetch.mjs";
import { hexOf, blobKey, fetchUnitFromCdn } from "./r2.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SNAP_DIR = join(ROOT, "snapshots");
const MAX_BYTES = 5 * 1024 * 1024; // escalate rather than commit larger binaries

// Sorted relative paths of every regular file under dir (deterministic order).
function walkFiles(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = lstatSync(full);
    if (st.isDirectory()) walkFiles(full, base, out);
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

// Canonical content hash: sha256 over each file's relative path + NUL + bytes,
// in sorted order — so the same tree always yields the same digest.
export function contentHash(unitDir) {
  const h = createHash("sha256");
  for (const rel of walkFiles(unitDir).sort()) {
    h.update(rel); h.update("\0"); h.update(readFileSync(join(unitDir, rel)));
  }
  return "sha256:" + h.digest("hex");
}

function byteSize(unitDir) {
  return walkFiles(unitDir).reduce((n, rel) => n + statSync(join(unitDir, rel)).size, 0);
}

export function readManifest(slug) {
  const p = join(SNAP_DIR, slug, "manifest.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}

// Produce a verified unit directory for a skill, sourced from the local committed
// snapshot when present, else fetched from R2/CDN. EITHER way the tree is re-hashed
// against the manifest's contentHash and throws on mismatch/absence — fail-closed,
// so a tampered/served-wrong/missing unit can never silently verify. This is the
// seam that lets certification survive PR-7 deleting the local `unit/` bytes: no
// local copy → read the content-addressed blob from R2 and re-hash it.
//
// SKILLS_FORCE_R2=1 skips the local copy entirely and forces the R2 path — so CI can
// prove the no-local read works WHILE the git bytes still exist (PR-7's precondition).
//
// Returns { dir, source: "local"|"r2", cleanup() }. Callers MUST call cleanup().
export function materializeUnit(slug, manifest, { snapDir = SNAP_DIR } = {}) {
  if (!manifest) throw new Error(`materializeUnit(${slug}): no manifest`);
  const local = join(snapDir, slug, "unit");
  const forceR2 = process.env.SKILLS_FORCE_R2 === "1";

  if (!forceR2 && existsSync(local)) {
    const h = contentHash(local);
    if (h !== manifest.contentHash) {
      throw new Error(`${slug}: local unit hash ${h} != manifest ${manifest.contentHash}`);
    }
    return { dir: local, source: "local", cleanup() {} };
  }

  // 2. R2/CDN blob — the durable store for already-published skills.
  const hex = hexOf(manifest.contentHash);
  const got = fetchUnitFromCdn(hex); // extracts into a fresh temp tree, or null on 404
  if (got) {
    const cleanup = () => rmSync(dirname(got), { recursive: true, force: true });
    const h = contentHash(got);
    if (h !== manifest.contentHash) {
      cleanup();
      throw new Error(`${slug}: CDN unit hash ${h} != manifest ${manifest.contentHash}`);
    }
    return { dir: got, source: "r2", cleanup };
  }

  // 3. Upstream reproduce @ the pinned SHA — for a NEW skill whose blob isn't in R2
  //    yet: its PR verifies against the TRUE SOURCE (fetch + assemble + re-hash vs the
  //    manifest, fail-closed); the blob is uploaded to R2 on merge. FORCE_R2 forbids
  //    this fallback so the R2-availability proof can't be silently satisfied upstream.
  if (forceR2) throw new Error(`${slug}: unit absent on the CDN (${blobKey(hex)}); SKILLS_FORCE_R2 forbids upstream fallback`);
  const assembled = assembleUnit(loadConfig(slug)); // network fetch of the pinned SHA
  const dir = assembled.unitDir;
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const h = contentHash(dir);
  if (h !== manifest.contentHash) {
    cleanup();
    throw new Error(`${slug}: upstream-reproduced hash ${h} != manifest ${manifest.contentHash} (re-run: pnpm snapshot ${slug} --write)`);
  }
  return { dir, source: "upstream", cleanup };
}

export function snapshot(slug, { write = false } = {}) {
  const cfg = loadConfig(slug);
  const assembled = assembleUnit(cfg); // live fetch of the pinned SHA
  const unit = assembled.unitDir;
  const byteSizeTotal = byteSize(unit);
  if (byteSizeTotal > MAX_BYTES) {
    throw new Error(`ESCALATE: ${slug} unit is ${byteSizeTotal} bytes (> 5 MB) — needs a storage decision, not committed inline`);
  }
  const manifest = {
    slug,
    upstream: { repo: cfg.upstream.repo, sha: cfg.upstream.sha, path: cfg.upstream.path || null },
    contentHash: contentHash(unit),
    byteSize: byteSizeTotal,
    fileCount: walkFiles(unit).length,
  };
  if (write) {
    // Manifest-only: the unit BYTES live in R2 (content-addressed), never in git —
    // the anti-bloat guard rejects a committed snapshots/*/unit tree. We keep just the
    // tiny trust anchor; the blob is uploaded to R2 (from upstream) on merge.
    const dest = join(SNAP_DIR, slug);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  }
  return manifest;
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) { console.error("usage: node scripts/snapshot.mjs <slug> [--write]"); process.exit(2); }
  const m = snapshot(slug, { write });
  console.error(`${write ? "wrote" : "would write"} snapshots/${slug} — ${m.fileCount} files, ${m.byteSize} bytes, ${m.contentHash}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
