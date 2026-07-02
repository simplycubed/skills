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
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, existsSync, readdirSync, statSync, lstatSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { loadConfig, assembleUnit } from "./fetch.mjs";

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
    const dest = join(SNAP_DIR, slug);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(unit, join(dest, "unit"), { recursive: true });
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
