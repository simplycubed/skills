// snapshot-check.mjs
//
// Gate: every status:active skill must have a committed, intact snapshot. For
// each skill assert (1) the snapshot exists, (2) its manifest SHA matches the
// config's pinned SHA, and (3) the unit's re-derived content hash matches the
// manifest — so a tampered or drifted snapshot fails CI. Fail-closed.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readActiveSkills } from "./generate.mjs";
import { readManifest, contentHash, SNAP_DIR } from "./snapshot.mjs";

const skills = readActiveSkills();
let ok = true;

for (const cfg of skills) {
  const dir = join(SNAP_DIR, cfg.slug);
  const unit = join(dir, "unit");
  const manifest = readManifest(cfg.slug);

  if (!manifest || !existsSync(unit)) {
    ok = false;
    console.log(`✗ ${cfg.slug}: no snapshot (run: pnpm snapshot ${cfg.slug} --write)`);
    continue;
  }
  if (manifest.upstream.sha !== cfg.upstream.sha) {
    ok = false;
    console.log(`✗ ${cfg.slug}: snapshot SHA ${manifest.upstream.sha} != config SHA ${cfg.upstream.sha} (re-snapshot)`);
    continue;
  }
  const actual = contentHash(unit);
  if (actual !== manifest.contentHash) {
    ok = false;
    console.log(`✗ ${cfg.slug}: content hash drift — manifest ${manifest.contentHash}, actual ${actual}`);
    continue;
  }
  console.log(`✓ ${cfg.slug}: snapshot intact (${manifest.fileCount} files, ${manifest.byteSize} bytes)`);
}

if (!ok) { console.error("✗ snapshot-check FAILED"); process.exit(1); }
console.log(`✓ all ${skills.length} active skill(s) have intact snapshots`);
