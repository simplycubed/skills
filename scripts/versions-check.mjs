// versions-check.mjs
//
// Gate: a listing's version MUST come from upstream, and must be valid. For every
// status:active skill, read the upstream-declared version captured in its snapshot
// manifest (byte-derived from SKILL.md at the pinned SHA) and assert it is EITHER
//   - null / absent  → "unversioned": legitimate, the storefront sorts by scan date, or
//   - strict semver  → used verbatim in catalog.json + marketplace.json.
// A version that is DECLARED upstream but is NOT strict semver (e.g. "v2.0.0",
// "2.8", "1.2.3-beta") is a hard failure: we never silently drop it or coerce it
// into an invalid catalog value — a human maps it deliberately (pin a SHA whose
// SKILL.md is semver, or record the decision). This is the forcing function that
// keeps the marketplace version equal to upstream's for every skill that declares one.
import { readActiveSkills } from "./generate.mjs";
import { readManifest } from "./snapshot.mjs";

export const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;

// Classify a manifest's upstreamVersion. Pure, so the self-test can drive it.
//   null/undefined → { ok, unversioned:true }
//   strict semver  → { ok, version }
//   anything else  → { ok:false, reason }
export function classifyVersion(upstreamVersion) {
  if (upstreamVersion == null) return { ok: true, unversioned: true };
  if (SEMVER.test(upstreamVersion)) return { ok: true, version: upstreamVersion };
  return {
    ok: false,
    reason: `upstream declares non-semver version "${upstreamVersion}" — map it deliberately ` +
      `(pin a SHA whose SKILL.md version is strict X.Y.Z, or record the decision); we never coerce it`,
  };
}

function main() {
  const skills = readActiveSkills();
  let ok = true;
  let versioned = 0, unversioned = 0;

  for (const cfg of skills) {
    const manifest = readManifest(cfg.slug);
    // Snapshot presence/integrity is snapshot:check's job — a missing manifest here
    // reads as unversioned and is not this gate's failure to raise.
    const v = classifyVersion(manifest ? manifest.upstreamVersion : null);
    if (!v.ok) {
      ok = false;
      console.log(`✗ ${cfg.slug}: ${v.reason}`);
      continue;
    }
    if (v.unversioned) unversioned++;
    else { versioned++; console.log(`✓ ${cfg.slug}: ${v.version} (from upstream)`); }
  }

  if (!ok) {
    console.error("✗ versions-check FAILED: an upstream version is not strict semver");
    process.exit(1);
  }
  console.log(`✓ versions OK — ${versioned} versioned (upstream-sourced), ${unversioned} unversioned`);
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
