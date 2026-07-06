// snapshot-check.mjs
//
// Gate: every status:active skill must have an intact, content-addressed snapshot.
// For each skill assert (1) a manifest exists, (2) its manifest SHA matches the
// config's pinned SHA, and (3) the unit's re-derived content hash matches the
// manifest — via materializeUnit, which sources the unit from the local committed
// copy OR (when absent / SKILLS_FORCE_R2=1) from R2, re-hashing either way. So this
// gate keeps working after PR-7 deletes the local `unit/` bytes: no local copy →
// verify the content-addressed blob served from R2. Fail-closed.
import { readActiveSkills } from "./generate.mjs";
import { readManifest, materializeUnit } from "./snapshot.mjs";

const skills = readActiveSkills();
let ok = true;

for (const cfg of skills) {
  const manifest = readManifest(cfg.slug);
  if (!manifest) {
    ok = false;
    console.log(`✗ ${cfg.slug}: no snapshot (run: pnpm snapshot ${cfg.slug} --write)`);
    continue;
  }
  if (manifest.upstream.sha !== cfg.upstream.sha) {
    ok = false;
    console.log(`✗ ${cfg.slug}: snapshot SHA ${manifest.upstream.sha} != config SHA ${cfg.upstream.sha} (re-snapshot)`);
    continue;
  }
  let mat;
  try {
    mat = materializeUnit(cfg.slug, manifest); // local-or-R2 + re-hash, throws on mismatch/absence
  } catch (e) {
    ok = false;
    console.log(`✗ ${cfg.slug}: ${e.message}`);
    continue;
  }
  console.log(`✓ ${cfg.slug}: snapshot intact [${mat.source}] (${manifest.fileCount} files, ${manifest.byteSize} bytes)`);
  mat.cleanup();
}

if (!ok) { console.error("✗ snapshot-check FAILED"); process.exit(1); }
console.log(`✓ all ${skills.length} active skill(s) have intact snapshots`);
