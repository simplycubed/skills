// funnel-report.mjs — the DRY-RUN ingestion funnel.
//
// Runs discover → phase1 in one process and prints a human-readable report:
//   - the three headline counts (found / permissive / new-after-dedup)
//   - distinct-source-owner coverage (proves we pull from many repos, not one)
//   - a sample of new candidates
// It DOES NOT call the quality+ICP judge — that endpoint is not live yet. The
// judge POST is stubbed below with the cross-repo contract shape so wiring it in
// is a one-spot change once skills-judge ships.
//
// Also writes the full new-candidate list to a JSON file (default
// `candidates.json`, or `--out <path>`) so the miner workflow can upload it as an
// artifact. Read-only + network only; no secrets, safe in `pnpm gate`-land
// (though gate does not invoke it — it needs `gh` + network).
import { writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discover, DEFAULT_ANCHORS } from "./discover.mjs";
import { phase1 } from "./phase1.mjs";

// ── Judge stub (cross-repo contract with simplycubed/skills-judge) ───────────
// When the judge Worker is live, POST each kept candidate's SKILL.md + metadata
// and keep only verdict === "keep". Contract (documented in docs/INGESTION.md and
// mirrored in skills-judge/CLAUDE.md):
//   REQUEST  { skillMd: string, metadata: { repo, sha, path, license, sourceUrl } }
//   RESPONSE { icpFit: number, quality: number, verdict: "keep"|"reject"|"review" }
// Fail-closed: anything but "keep" does NOT auto-ingest.
async function judge(_candidate) {
  // TODO(skills-judge): POST to the authenticated judge endpoint and return the
  // verdict. Endpoint URL + caller token land here once the Worker is deployed.
  // See docs/INGESTION.md "Cross-repo judge contract".
  return { verdict: "review", stubbed: true };
}

function ownerOf(repo) {
  return String(repo).split("/")[0];
}

function report({ anchors = DEFAULT_ANCHORS, withContentHash = false, out = "candidates.json" } = {}) {
  const t0 = Date.now();
  const { candidates, dropped } = discover({ anchors });
  const r = phase1(candidates, { withContentHash });

  const owners = new Set(r.kept.map((c) => ownerOf(c.repo)));
  const foundOwners = new Set(candidates.map((c) => ownerOf(c.repo)));

  const lines = [];
  const p = (s = "") => lines.push(s);
  p("═══════════════════════════════════════════════════════════════");
  p("  Skills ingestion funnel — DRY RUN (discover → phase1)");
  p("═══════════════════════════════════════════════════════════════");
  p(`  anchors searched      : ${anchors.length}`);
  p(`  candidates FOUND       : ${r.counts.found}   (from ${foundOwners.size} distinct owners)`);
  p(`  → PERMISSIVE license   : ${r.counts.permissive}`);
  p(`  → NEW after dedup      : ${r.counts.newAfterDedup}   (from ${owners.size} distinct owners)`);
  p(`  rejected (license)     : ${r.rejectedLicense.length}`);
  p(`  already ingested       : ${r.alreadyIngested.length}   (deduped vs catalog.json)`);
  p(`  dropped (no metadata)  : ${dropped.length}`);
  p(`  judge step             : STUBBED (skills-judge endpoint not live — no POST)`);
  p(`  elapsed                : ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  p("───────────────────────────────────────────────────────────────");
  p(`  Sample of NEW candidates (up to 15):`);
  for (const c of r.kept.slice(0, 15)) {
    p(`   • ${c.repo}${c.path ? "/" + c.path : ""}  [${c.license}]  @ ${String(c.sha).slice(0, 8)}`);
  }
  if (r.kept.length === 0) p("   (none — every discovered permissive skill is already ingested)");
  p("───────────────────────────────────────────────────────────────");
  p(`  License-reject breakdown (top reasons):`);
  const byLic = new Map();
  for (const c of r.rejectedLicense) byLic.set(c.license ?? "none", (byLic.get(c.license ?? "none") || 0) + 1);
  for (const [lic, n] of [...byLic.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) p(`     ${String(lic).padEnd(16)} ${n}`);
  p("═══════════════════════════════════════════════════════════════");

  writeFileSync(out, JSON.stringify({
    generatedBy: "funnel-report.mjs (dry-run)",
    counts: r.counts,
    distinctOwners: owners.size,
    kept: r.kept,
    rejectedLicense: r.rejectedLicense,
    dropped,
  }, null, 2) + "\n");
  p(`  full new-candidate list written to: ${out}`);

  return { text: lines.join("\n"), result: r };
}

function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf("--out");
  const out = outIdx >= 0 ? argv[outIdx + 1] : "candidates.json";
  const withContentHash = argv.includes("--content-hash");
  const anchors = argv.includes("--quick") ? DEFAULT_ANCHORS.slice(0, 3) : DEFAULT_ANCHORS;
  const { text } = report({ anchors, withContentHash, out });
  console.log(text);
}

// judge() is exported for the future wire-in + so it is not flagged as dead code.
export { report, judge };

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
