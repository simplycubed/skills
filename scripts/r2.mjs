// r2.mjs — object I/O for the content-addressed snapshot store (R2).
//
// The snapshot BYTES live in R2, not git. One bucket, content-addressed by the
// SAME `contentHash` snapshot.mjs already computes over the EXTRACTED tree
// (`relpath + NUL + bytes`, sorted). The `.tar.gz` is transport only and may be
// byte-nondeterministic — integrity NEVER comes from the transport: callers
// re-extract and re-hash the tree and compare to the git manifest. So this
// module deliberately hashes nothing.
//
// READS (CI gate, no credentials): public GET from the bucket's custom domain.
// WRITES (push:main / migration Actions only): R2 S3-compatible API via a lazily
// imported `aws4fetch`, so this module loads and self-tests without the dep or
// any credentials present.
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

// WRITE (main/migration only): idempotent PUT to R2 (S3 API), one bucket.
// Lazily imports aws4fetch so this module needs neither the dep nor creds to load.
function reqEnv(k) { const v = process.env[k]; if (!v) throw new Error(`r2.mjs: missing env ${k}`); return v; }
async function client() {
  const { AwsClient } = await import("aws4fetch");
  return new AwsClient({ accessKeyId: reqEnv("R2_ACCESS_KEY_ID"), secretAccessKey: reqEnv("R2_SECRET_ACCESS_KEY"), region: "auto", service: "s3" });
}
const objectUrl = (key) => `https://${reqEnv("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${reqEnv("R2_BUCKET")}/${key}`;

async function putIfAbsent(key, body, contentType) {
  const aws = await client();
  const head = await aws.fetch(objectUrl(key), { method: "HEAD" });
  if (head.ok) return { skipped: true }; // content-addressed ⇒ write-once
  const put = await aws.fetch(objectUrl(key), { method: "PUT", body, headers: { "content-type": contentType } });
  if (!put.ok) throw new Error(`r2 PUT ${key} failed: ${put.status} ${await put.text().catch(() => "")}`);
  return { skipped: false };
}

export const putBlob = (hex, buf) => putIfAbsent(blobKey(hex), buf, "application/gzip");
export const putRecord = (hex, json) => putIfAbsent(recordKey(hex), typeof json === "string" ? json : JSON.stringify(json), "application/json");
