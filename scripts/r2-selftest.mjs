// r2-selftest.mjs
//
// Proves the R2 transport is lossless for the property that matters: packing a
// unit tree and unpacking it reproduces the EXACT SAME content hash. The gzip
// tarball bytes are non-deterministic (transport only) — what must round-trip is
// the extracted tree's contentHash, which is the marketplace's integrity anchor.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { packUnit, unpackToTmp, hexOf, blobKey, recordKey } from "./r2.mjs";
import { contentHash } from "./snapshot.mjs";

let ok = true;
const check = (label, cond) => { if (!cond) ok = false; console.log(`${cond ? "✓" : "✗"} ${label}`); };

// key helpers
check("hexOf strips the sha256: prefix", hexOf("sha256:abc123") === "abc123");
check("blobKey/recordKey shape", blobKey("deadbeef") === "blobs/sha256/deadbeef/unit.tar.gz" && recordKey("deadbeef") === "records/sha256/deadbeef.json");

// build a representative unit: nested dirs + a binary-ish file
const src = mkdtempSync(join(tmpdir(), "r2-src-"));
mkdirSync(join(src, "references"), { recursive: true });
mkdirSync(join(src, "assets"), { recursive: true });
writeFileSync(join(src, "SKILL.md"), "---\nname: t\ndescription: d\n---\n# Body\n");
writeFileSync(join(src, "LICENSE"), "MIT License\n");
writeFileSync(join(src, "references/a.md"), "alpha\n");
writeFileSync(join(src, "assets/logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]));

const before = contentHash(src);
const roundTripped = unpackToTmp(packUnit(src));
const after = contentHash(roundTripped);
check(`pack → unpack preserves contentHash exactly (${before.slice(0, 16)}…)`, before === after);

rmSync(src, { recursive: true, force: true });
rmSync(roundTripped, { recursive: true, force: true });

if (!ok) { console.error("✗ r2 self-test FAILED"); process.exit(1); }
console.log("✓ r2 self-test passed (transport is contentHash-lossless)");
