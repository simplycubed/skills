// r2-migrate.mjs — upload every active skill's snapshot blob + scan record to R2.
//
// Content-addressed by the SAME `contentHash` the git manifest already attests,
// so uploads are immutable and the whole run is idempotent (re-runnable, PUTs the
// same bytes to the same key). Integrity is re-verified against the git manifest
// BEFORE every upload — fail-closed: we never push bytes git doesn't vouch for.
//
// Modes:
//   (default)    upload  — pack + `wrangler r2 object put` blob & record (needs the
//                          R2-write CLOUDFLARE_API_TOKEN + account).
//   --sync       per-skill upload → verify off the CDN → ROLL BACK (delete) on a
//                failed verify. Idempotent: skips whatever already re-hashes clean on
//                the CDN. This is the auto-upload-on-merge path — "always upload it;
//                if the check fails, remove it." Needs R2-write creds.
//   --dry-run    verify + pack every unit, upload NOTHING. No credentials — this is
//                the CI gate: proves the migration is sound on the live git bytes.
//   --verify     fetch each blob back off the live CDN, re-extract, re-hash, and
//                assert it equals the git manifest. No credentials (public CDN read)
//                — the post-upload round-trip that closes the integrity loop.
import { existsSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readActiveSkills } from "./generate.mjs";
import { readManifest, contentHash, SNAP_DIR } from "./snapshot.mjs";
import { hexOf, blobKey, recordKey, packUnit, fetchUnitFromCdn, cdnUrl } from "./r2.mjs";

const SYNC = process.argv.includes("--sync");
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

function wranglerDelete(key) {
  const r = spawnSync("wrangler", ["r2", "object", "delete", `${BUCKET}/${key}`, "--remote"], { stdio: "inherit" });
  // Rollback is best-effort: a stuck bad blob is caught again by the drift monitor.
  if (r.status !== 0) console.warn(`⚠ rollback delete ${key} failed (exit ${r.status}) — flag for manual cleanup`);
}

// GET (not HEAD — the Worker only implements GET) the CDN URL; true on 2xx.
function onCdn(key) {
  return spawnSync("curl", ["-sSLf", "-o", "/dev/null", cdnUrl(key)], { encoding: "utf8" }).status === 0;
}

// Fetch the blob back off the CDN and re-hash vs the manifest. Retries only the
// NOT-YET-VISIBLE case (edge propagation); a present-but-wrong blob returns false
// immediately (it's corrupt, not slow). Returns true only on an exact hash match.
async function cdnVerifies(hex, manifest, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const got = fetchUnitFromCdn(hex);
    if (got) {
      const rt = contentHash(got);
      rmSync(dirname(got), { recursive: true, force: true });
      return rt === manifest.contentHash;
    }
    await sleep(3000);
  }
  return false;
}

const skills = readActiveSkills();
const mode = SYNC ? "sync" : VERIFY ? "verify" : DRY ? "dry-run" : "upload";
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

  // SYNC = the auto-upload path: always push, verify off the CDN, roll back on fail.
  if (SYNC) {
    // Source bytes are the local unit (fail-closed vs manifest). Post-PR-7, when the
    // git bytes are gone, this is where an upstream re-fetch@SHA would substitute.
    if (!existsSync(unit) || contentHash(unit) !== manifest.contentHash) {
      ok = false;
      console.log(`✗ ${slug}: local unit missing or drifted — cannot source bytes to upload`);
      continue;
    }
    if (onCdn(blobKey(hex)) && onCdn(recordKey(hex))) {
      console.log(`• ${slug}: already on CDN (content-addressed) — skip`);
      continue;
    }
    const tmp = mkdtempSync(join(tmpdir(), `r2-sync-${slug}-`));
    try {
      const tar = join(tmp, "unit.tar.gz");
      writeFileSync(tar, packUnit(unit));
      wranglerPut(blobKey(hex), tar, "application/gzip");
      wranglerPut(recordKey(hex), record, "application/json");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    if (await cdnVerifies(hex, manifest)) {
      done++;
      console.log(`✓ ${slug}: uploaded + CDN re-hash verified (${hex.slice(0, 16)}…)`);
    } else {
      ok = false;
      console.log(`✗ ${slug}: post-upload verify FAILED — rolling back`);
      wranglerDelete(blobKey(hex));
      wranglerDelete(recordKey(hex));
    }
    continue;
  }

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
      : mode === "sync"
        ? `✓ sync: ${skills.length} active skill(s) reconciled to R2 (${done} uploaded+verified this run)`
        : `✓ uploaded ${done}/${skills.length} active skill(s) to R2 bucket ${BUCKET}`
);
