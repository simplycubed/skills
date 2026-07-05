// r2-migrate.mjs — upload every active skill's snapshot blob + scan record to R2.
//
// Content-addressed by the SAME `contentHash` the git manifest already attests,
// so uploads are immutable and the whole run is idempotent (re-runnable, PUTs the
// same bytes to the same key). Integrity is re-verified against the git manifest
// BEFORE every upload — fail-closed: we never push bytes git doesn't vouch for.
//
// Modes:
//   (default)    upload  — pack + `wrangler r2 object put` blob & record (needs the
//                          prod CLOUDFLARE_API_TOKEN + account).
//   --dry-run    verify + pack every unit, upload NOTHING. No credentials — this is
//                the CI gate: proves the migration is sound on the live git bytes.
//   --verify     fetch each blob back off the live CDN, re-extract, re-hash, and
//                assert it equals the git manifest. No credentials (public CDN read)
//                — the post-upload round-trip that closes the integrity loop.
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { readActiveSkills } from "./generate.mjs";
import { readManifest, contentHash, SNAP_DIR } from "./snapshot.mjs";
import { hexOf, blobKey, recordKey, packUnit, fetchUnitFromCdn } from "./r2.mjs";

const DRY = process.argv.includes("--dry-run");
const VERIFY = process.argv.includes("--verify");
const BUCKET = process.env.R2_BUCKET || "simplycubed-skills";
const ROOT = process.cwd();

function wranglerPut(key, file, contentType) {
  const r = spawnSync(
    "wrangler",
    ["r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", contentType, "--remote"],
    { stdio: "inherit" }
  );
  if (r.status !== 0) throw new Error(`wrangler r2 object put ${key} failed (exit ${r.status})`);
}

const skills = readActiveSkills();
const mode = VERIFY ? "verify" : DRY ? "dry-run" : "upload";
let ok = true;
let done = 0;

for (const cfg of skills) {
  const slug = cfg.slug;
  const unit = join(SNAP_DIR, slug, "unit");
  const manifest = readManifest(slug);
  const record = join(ROOT, "config", "skills", `${slug}.scan.json`);

  if (!manifest || !existsSync(unit)) { ok = false; console.log(`✗ ${slug}: no snapshot`); continue; }
  if (!existsSync(record)) { ok = false; console.log(`✗ ${slug}: no scan record`); continue; }

  const hex = hexOf(manifest.contentHash);

  // VERIFY reads the published bytes, not the local ones — the whole point is to
  // confirm what R2/CDN actually serves matches the git manifest end to end.
  if (VERIFY) {
    const got = fetchUnitFromCdn(hex);
    if (!got) { ok = false; console.log(`✗ ${slug}: blob absent from CDN (${blobKey(hex)})`); continue; }
    const roundTrip = contentHash(got);
    rmSync(dirname(got), { recursive: true, force: true });
    if (roundTrip !== manifest.contentHash) {
      ok = false;
      console.log(`✗ ${slug}: CDN blob re-hash ${roundTrip} != manifest ${manifest.contentHash}`);
      continue;
    }
    done++;
    console.log(`✓ ${slug}: CDN blob re-hashes to manifest (${hex.slice(0, 16)}…)`);
    continue;
  }

  // upload / dry-run both re-verify the LOCAL unit before doing anything.
  const actual = contentHash(unit);
  if (actual !== manifest.contentHash) {
    ok = false;
    console.log(`✗ ${slug}: content hash drift — manifest ${manifest.contentHash}, actual ${actual}`);
    continue;
  }

  const tmp = mkdtempSync(join(tmpdir(), `r2-mig-${slug}-`));
  try {
    const tar = join(tmp, "unit.tar.gz");
    writeFileSync(tar, packUnit(unit)); // proves it packs even in dry-run
    if (DRY) {
      console.log(`• ${slug}: OK → ${blobKey(hex)} + ${recordKey(hex)}`);
    } else {
      wranglerPut(blobKey(hex), tar, "application/gzip");
      wranglerPut(recordKey(hex), record, "application/json");
      done++;
      console.log(`✓ ${slug}: uploaded blob + record (${hex.slice(0, 16)}…)`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (!ok) { console.error(`✗ r2-migrate (${mode}) FAILED`); process.exit(1); }
console.log(
  mode === "dry-run"
    ? `✓ dry-run: all ${skills.length} active skill(s) verified + packable (no upload)`
    : mode === "verify"
      ? `✓ verify: all ${done}/${skills.length} CDN blob(s) re-hash to the git manifest`
      : `✓ uploaded ${done}/${skills.length} active skill(s) to R2 bucket ${BUCKET}`
);
