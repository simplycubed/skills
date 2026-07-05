// r2.mjs — object I/O for the content-addressed snapshot store (R2).
//
// The snapshot BYTES live in R2, not git. One bucket, content-addressed by the
// SAME `contentHash` snapshot.mjs already computes over the EXTRACTED tree
// (`relpath + NUL + bytes`, sorted). The `.tar.gz` is transport only and may be
// byte-nondeterministic — integrity NEVER comes from the transport: callers
// re-extract and re-hash the tree and compare to the git manifest. So this
// module deliberately hashes nothing.
//
// READS (everywhere, no credentials): public GET via the CDN Worker.
// WRITES: not here — uploads are `wrangler r2 object put` in scripts/r2-sync.mjs,
// run only by the provisioning/sync Actions under one CLOUDFLARE_API_TOKEN. This
// module is therefore credential-free and loads with no extra dependency.
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CDN_BASE = process.env.CDN_BASE || "https://cdn.simplycubed.com";

export const hexOf = (contentHash) => String(contentHash).replace(/^sha256:/, "");
export const blobKey = (hex) => `blobs/sha256/${hex}/unit.tar.gz`;
export const recordKey = (hex) => `records/sha256/${hex}.json`;
export const cdnUrl = (key) => `${CDN_BASE}/${key}`;

// Pack an extracted unit dir into a gzipped tar (transport only). Returns Buffer.
export function packUnit(unitDir) {
  const r = spawnSync("tar", ["-czf", "-", "-C", unitDir, "."], { maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`packUnit: tar failed: ${r.stderr}`);
  return r.stdout;
}

// Unpack a gzipped-tar Buffer into a fresh temp dir. Returns the dir path.
export function unpackToTmp(buf) {
  const dir = mkdtempSync(join(tmpdir(), "r2-unit-"));
  const r = spawnSync("tar", ["-xzf", "-", "-C", dir], { input: buf, maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) { rmSync(dir, { recursive: true, force: true }); throw new Error(`unpackToTmp: tar failed: ${r.stderr}`); }
  return dir;
}

// READ (no creds): GET blobs/sha256/<hex>/unit.tar.gz from the CDN, extract into
// a temp dir. Returns the dir, or null on a 404 (blob not yet in R2). The caller
// MUST re-hash the returned tree and compare to the git manifest — this does not.
export function fetchUnitFromCdn(hex) {
  const tmp = mkdtempSync(join(tmpdir(), "r2-dl-"));
  const tarball = join(tmp, "unit.tar.gz");
  const dl = spawnSync("curl", ["-sSLf", "-o", tarball, cdnUrl(blobKey(hex))], { encoding: "utf8" });
  if (dl.status !== 0 || !existsSync(tarball)) { rmSync(tmp, { recursive: true, force: true }); return null; }
  const dir = join(tmp, "unit");
  spawnSync("mkdir", ["-p", dir]);
  const ex = spawnSync("tar", ["-xzf", tarball, "-C", dir]);
  if (ex.status !== 0) { rmSync(tmp, { recursive: true, force: true }); throw new Error(`fetchUnitFromCdn: extract failed for ${hex}`); }
  return dir;
}

// Is a content-addressed object already public on the CDN? Used by r2-sync to
// skip re-uploads (content-addressed keys are write-once, so this is idempotency,
// not correctness).
export function existsOnCdn(key) {
  const r = spawnSync("curl", ["-sSIf", "-o", "/dev/null", cdnUrl(key)], { encoding: "utf8" });
  return r.status === 0;
}
