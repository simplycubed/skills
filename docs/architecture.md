# Architecture — the content-addressed snapshot store

How a skill's bytes flow from an upstream repo to the storefront, and why verification is
trustworthy even though the bytes live outside git.

## The spine

> A skill's identity is the **sha256 of its exact published bytes** (`contentHash`).

Everything is keyed by that hash:
- **Bytes** → R2 at `blobs/sha256/<hex>/unit.tar.gz`, served immutably from `cdn.simplycubed.com`.
- **Scan record** → R2 at `records/sha256/<hex>.json` (and the display copy in `config/skills/<slug>.scan.json`).
- **Trust anchor** → `snapshots/<slug>/manifest.json` in git: the `contentHash`, `byteSize`, `fileCount`, and the pinned `upstream {repo, sha, path}`.

Because the key *is* the hash, an object can never be silently changed: a different byte → a
different key. Reads are self-verifying.

## Assembling "the unit" (`scripts/fetch.mjs`)

`assembleUnit(cfg)`: fetch the upstream repo at its **pinned SHA**, take the skill's subpath, and —
critically — **copy the repo-root LICENSE into the unit** if the subdir has none (permissive
redistribution requires the license notice to travel with the copy). It then confirms the LICENSE
text matches the declared SPDX id and **fails closed on a mismatch**, so a config can't mislabel a
license. In-repo symlinks are dereferenced; escaping symlinks are rejected. Work happens in a temp
dir (never in the repo) and is removed after use.

`contentHash(unitDir)` = sha256 over each file's `relpath + NUL + bytes`, in sorted order — so the
same tree always yields the same digest.

## Verification: `materializeUnit` (`scripts/snapshot.mjs`)

The one seam every verifier goes through. Given a slug + its manifest, it produces a unit directory
and **re-hashes it against the manifest, throwing fail-closed on any mismatch or absence.** It tries
three sources in order:

1. **Local** committed `snapshots/<slug>/unit` — only if present (pre-migration / tests).
2. **R2/CDN** — fetch `blobs/sha256/<hex>/unit.tar.gz`, extract, re-hash. The durable source for
   published skills.
3. **Upstream reproduce** — assemble from the pinned SHA, re-hash. This is how a **new** skill's PR
   verifies before its blob is in R2 (the blob uploads on merge).

`SKILLS_FORCE_R2=1` skips local **and** forbids the upstream fallback — used in CI to prove the R2
read path works on its own (so a failure can't be masked by reproducing from upstream).

Consumers: `snapshot:check` (gate), `certify:active` (re-runs the full scanner suite on the
materialized unit), and `r2:sync` (sources bytes to upload).

## Why bytes live in R2, not git

Git history is permanent — commit GBs once and every clone carries them forever. At 14 skills we
migrated the bytes to R2 so the future thousands of blobs never enter history. Git keeps only the
tiny `manifest.json` anchors; a CI **anti-bloat guard** (`scripts/bloat-guard.mjs`) rejects any
re-committed `snapshots/*/unit` tree. R2 is content-addressed (immutable, deduped) with **zero
egress cost**.

## Fail-closed, everywhere

- License mismatch → refuse (in `assembleUnit`).
- A required scanner missing → `passed: false` (never a silent skip).
- A materialized unit whose hash ≠ manifest → throw.
- A blob absent from R2 with `SKILLS_FORCE_R2` → throw (no upstream mask).
- The committed `scan.json` is only a **display copy** — CI re-runs the live scan and fails if the
  live verdict isn't a pass, so a hand-edited record can't smuggle a failing skill through.

## The generated artifacts (`scripts/generate.mjs`)

From `config/skills/*.yaml` + each `scan.json` + each `manifest.json`, deterministically emit:
- **`catalog.json`** (`schemaVersion: 2`) — the storefront's data. `install.folder.source` points at
  the content-addressed CDN tarball (built from the manifest's hash).
- **`.claude-plugin/marketplace.json`** — what Claude Code reads.

Both are committed; a CI **no-drift** check regenerates them and fails if they differ, so they can't
be hand-edited or go stale.
