// r2-copy.mjs — copy every snapshot object from one R2 bucket to another.
//
// R2 has no bucket rename, so moving to the <repo>-<thing>-<env> convention is a
// migration: create the new bucket, copy the objects, cut the Worker binding over,
// verify, then delete the old bucket. This script is the copy step.
//
// Why a copy and not a re-upload from source: only `manifest.json` is committed.
// The unit bytes live in R2 and nowhere else in this repo, so they cannot be
// re-derived from git the way r2-migrate.mjs re-derives them when a local unit/
// tree exists. What git DOES give us is the full key list: every object is
// content-addressed off the manifest's contentHash, so the active manifests name
// all objects without ever listing the bucket.
//
// Fail-closed, matching the rest of the R2 tooling: every blob is re-hashed and
// checked against the git manifest AFTER the read and BEFORE the write, so a
// corrupt or truncated source object is never propagated into the new bucket.
//
// Idempotent: an object already present in the destination is skipped, so a
// re-run after a partial failure resumes rather than repeats.
//
// Usage:
//   R2_SOURCE_BUCKET=old R2_BUCKET=new node scripts/r2-copy.mjs
//   R2_SOURCE_BUCKET=old R2_BUCKET=new node scripts/r2-copy.mjs --dry-run
//
// Needs wrangler on PATH plus CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID with
// read on the source and write on the destination. It never deletes anything:
// dropping the old bucket stays a separate, deliberate human step.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { hexOf, blobKey, recordKey } from "./r2.mjs";
import { readActiveSkills } from "./generate.mjs";
import { readManifest } from "./snapshot.mjs";

const SOURCE = process.env.R2_SOURCE_BUCKET;
const DEST = process.env.R2_BUCKET;
const DRY = process.argv.includes("--dry-run");

if (!SOURCE || !DEST) {
  console.error("✗ set R2_SOURCE_BUCKET and R2_BUCKET (the destination)");
  process.exit(1);
}
if (SOURCE === DEST) {
  console.error("✗ R2_SOURCE_BUCKET and R2_BUCKET are the same bucket");
  process.exit(1);
}

const sha256 = (buf) => `sha256:${createHash("sha256").update(buf).digest("hex")}`;

function objectGet(bucket, key, file) {
  const r = spawnSync("wrangler", ["r2", "object", "get", `${bucket}/${key}`, "--file", file, "--remote"], {
    encoding: "utf8",
  });
  return r.status === 0 && existsSync(file);
}

function objectExists(bucket, key) {
  const tmp = mkdtempSync(join(tmpdir(), "r2-head-"));
  try {
    return objectGet(bucket, key, join(tmp, "probe"));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function objectPut(bucket, key, file, contentType) {
  const r = spawnSync(
    "wrangler",
    ["r2", "object", "put", `${bucket}/${key}`, "--file", file, "--content-type", contentType, "--remote"],
    { stdio: "inherit" },
  );
  if (r.status !== 0) throw new Error(`put ${bucket}/${key} failed (exit ${r.status})`);
}

const skills = readActiveSkills();
console.log(`r2-copy: ${skills.length} active skill(s), ${SOURCE} → ${DEST}${DRY ? " (dry-run)" : ""}\n`);

let copied = 0;
let skipped = 0;
let failed = 0;

for (const cfg of skills) {
  const slug = cfg.slug;
  const manifest = readManifest(slug);
  if (!manifest) {
    console.log(`✗ ${slug}: no manifest`);
    failed++;
    continue;
  }
  const hex = hexOf(manifest.contentHash);
  const units = [
    { key: blobKey(hex), type: "application/gzip", verify: true },
    { key: recordKey(hex), type: "application/json", verify: false },
  ];

  const tmp = mkdtempSync(join(tmpdir(), "r2-copy-"));
  try {
    for (const { key, type, verify } of units) {
      // Dry-run is deliberately offline: it derives the key set from the committed
      // manifests and touches no bucket, so it needs no credentials and can run in
      // the gate. Probing the destination first would defeat that.
      if (DRY) {
        console.log(`• ${slug}: would copy ${key}`);
        copied++;
        continue;
      }
      if (objectExists(DEST, key)) {
        skipped++;
        continue;
      }

      const file = join(tmp, key.replace(/\//g, "_"));
      if (!objectGet(SOURCE, key, file)) {
        console.log(`✗ ${slug}: ${key} absent from ${SOURCE}`);
        failed++;
        continue;
      }

      // The blob is content-addressed, so the bytes we just read must re-hash to
      // exactly what the committed manifest attests. Anything else is a corrupt
      // source object and must not reach the new bucket.
      if (verify) {
        const got = sha256(readFileSync(file));
        if (got !== manifest.contentHash) {
          console.log(`✗ ${slug}: ${key} hash mismatch (git says ${manifest.contentHash}, ${SOURCE} gave ${got})`);
          failed++;
          continue;
        }
      }

      objectPut(DEST, key, file, type);
      console.log(`✓ ${slug}: ${key}`);
      copied++;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\ncopied ${copied}, already present ${skipped}, failed ${failed}`);
if (failed > 0) {
  console.error("✗ copy incomplete — do NOT cut the Worker binding over yet");
  process.exit(1);
}
console.log(
  DRY
    ? `✓ dry-run clean: ${copied} object(s) derived from git, nothing copied`
    : `✓ ${DEST} holds every object ${SOURCE} was serving`,
);
