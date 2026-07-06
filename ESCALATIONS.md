# Escalations — what needs a human (Charles)

The autonomous loop finished the R2 migration + Phase-0 hardening as **one consolidated
PR** to `main` (the earlier stacked PRs #33–#36 were closed and folded into it). Nothing
was merged; no prod action was taken. This file lists everything that needs your hands.

## The one PR

**R2 migration (PR-5→7) + 2 Phase-0 detectors, consolidated.** One branch, reviewable by
commit, mergeable atomically. Its green CI **proves the repo verifies purely from R2 with
the local unit bytes deleted** (snapshot:check + certify:active read every unit from the
CDN, re-hashed vs the manifest, fail-closed) — so the byte-deletion precondition is met
inside this PR, not across a stack.

**Merge it when BOTH hold:**
1. **CI is green.**
2. **The web storefront receiver understands `schemaVersion: 2`** (below) — otherwise the
   live storefront breaks on merge, because catalog.json flips to v2 the moment this lands.

A squash merge is fine now (single PR); the earlier "never squash" hazard applied only to
the abandoned stack.

## Web receiver contract — `schemaVersion` 1 → 2 (coordinate with the web session)

Share this with the `simplycubed/web` session; it must ship **before/with** this merge.

- **`schemaVersion` is now `2`.** The consumer must accept 2 (it is told to refuse unknown
  versions). This is the only breaking change.
- **`install.folder.source` now points at the CDN tarball** —
  `https://cdn.simplycubed.com/blobs/sha256/<hash>/unit.tar.gz` — not a browsable GitHub
  tree. **UX change:** the storefront's "download the folder" flow must present a
  **download-and-extract a `.tar.gz`**, not "browse the tree." Everything else in each
  skill entry is unchanged.

### Deferred proposals (documented, NOT built — decide later)
These were intentionally left out to keep the web-breaking change minimal:
- **Record-by-reference** — replace the embedded `certification.record` with a
  `certification.recordUrl` → `records/sha256/<hash>.json` on the CDN + a small inline
  summary. Pure scale optimization; at 14 skills the embedded record is fine.
- **Trust tier** — surface a T0–T3 badge as a **new field `certification.trustTier`**
  (derivation not yet built). **Do NOT reuse the existing `tier` field — that is pricing
  (free/premium).**
- **Capability tags** (network/exec/fs/env) from an expanded semgrep SAST pass.
- **Verdict cache** (`contentHash × toolsetHash`) — deferred by the loop as the one change
  that could produce a silent false-green; only add with a self-test proving a
  `semgrep-rules.yml` edit busts the cache.

## Activate the PR-4 auto-upload (optional, enables new-skill blobs on merge)

Already merged (#32) but dormant. To turn it on:
1. Create a GitHub **Environment `r2-write`** (no required reviewer — uploads are
   content-addressed + verified + auto-rolled-back, i.e. reversible).
2. Mint an **R2-write-only** token (`Account → Workers R2 Storage: Edit`, nothing else),
   store as `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in that environment.
3. Set repo **variable** `R2_AUTOUPLOAD = true`.

## Post-merge follow-up (deferred, tracked)

- **`r2-sync` / `r2-migrate` read LOCAL units** to upload — but this PR deletes them. That
  path now needs an **upstream-reproduce rework** (re-fetch @ pinned SHA → re-assemble →
  re-hash == manifest → upload) so new skills' blobs can be produced without local bytes.
  It's dormant behind `R2_AUTOUPLOAD`, so nothing breaks until you activate auto-upload —
  do this rework before then.
- **Drift monitor** (`r2-verify.yml`, daily): confirm a **demonstrate-it-goes-red** run
  once (dispatch against a tampered hex) and wire a failure notification — a monitor only
  ever seen green is unproven.
