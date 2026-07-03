# Certification methodology

**Version: v1 (2026-07).** This document describes *exactly* the checks we run to
certify a skill — no more. The "Scanned & Verified" badge means a skill passed
these checks, on a stated date, with the tool versions recorded in its
`<slug>.scan.json`. It lowers risk; it does not prove a skill is safe to run.
Skills can still execute code and make network calls — review anything before you
trust it with sensitive access.

Certification is a **fail-closed gate**: a skill is listed only if every blocking
check passes. It re-runs in CI on the pinned upstream bytes for every change, so a
committed scan record cannot certify a skill that does not actually pass.

## What we scan

We certify the **published unit** — the exact bytes an agent installs — fetched
from the upstream repository at an **immutable commit SHA** (never a tag or
branch). For a skill in a subdirectory, the unit is that subdirectory; if it has
no license of its own, we copy the repository-root LICENSE into the unit (as
permissive redistribution requires) and confirm the text matches the declared
SPDX identifier.

## The checks

1. **Integrity / structure** — the pinned SHA must be the exact bytes: no git
   submodules, no Git LFS pointer files, no symlinks that escape the skill root,
   no oversized (non-text) blobs.
2. **License** — a LICENSE/COPYING must be present in the published unit, and its
   text must match the declared permissive SPDX license. Copyleft or unlicensed
   skills are rejected.
3. **Prompt-injection heuristics** (`SKILL.md` and other instruction text),
   split into two tiers:
   - **Blocking** — action-shaped patterns that are near-always malicious inside
     skill instructions: pipe-to-shell downloads, decode-and-execute, posting
     secrets to a remote, "ignore previous instructions" overrides. Any hit fails
     certification.
   - **Review** — vocabulary legitimate skills routinely use *defensively*
     (credential-file references, exfiltration terms, code-execution APIs). These
     are **surfaced** in the scan record for review, not auto-failed. Intent
     adjudication is the job of the planned `SKILL.md` LLM-judge (below).
4. **Secret scanning** — [`gitleaks`](https://github.com/gitleaks/gitleaks) over
   the published bytes. Any leaked credential fails certification.
5. **Dependency vulnerabilities** — [`osv-scanner`](https://github.com/google/osv-scanner)
   over any dependency manifests in the unit, against the OSV database. Known
   vulnerabilities fail certification.
6. **SAST** — [`semgrep`](https://github.com/semgrep/semgrep) over any bundled
   scripts, using a **pinned local ruleset** (`config/semgrep-rules.yml`, never
   `--config auto`) so the result is deterministic and no rules are fetched at scan
   time. Runs only when the unit contains code; a match fails certification.

The exact tool **versions** used for each scan are recorded in that skill's
`<slug>.scan.json` under `tools`, alongside every finding and every review flag —
so the record shows precisely what was checked, when, and with what.

## Durability: the content-addressed snapshot

At certification we vendor the exact published unit into `snapshots/<slug>/`, with
a `manifest.json` recording the upstream `{repo, sha}` and a sha256 over the unit
bytes. From then on, **re-verification reads the snapshot, not the upstream** — so
a skill stays available and auditable even if its upstream repo disappears. The
`snapshot:check` gate re-derives the content hash on every CI run, so a tampered
or drifted snapshot fails closed.

## How the gate stays honest

- **Self-test.** CI proves each scanner actually fires: planted-dirty fixtures
  must be flagged and a clean fixture must pass. A gate never seen to go red is a
  false-clear.
- **Snapshot re-verification.** CI re-runs the full scan over every active skill's
  committed snapshot (no upstream fetch). The committed `scan.json` is only a
  display copy; merge requires this re-scan to still pass.
- **Re-scan on change.** A new upstream release is a new commit + a new snapshot,
  so it goes back through the gate before we offer it.
- **Revocation.** If a listed skill later fails (a newly disclosed vuln, a leaked
  secret), its status flips to `revoked` and we pull it — and its snapshot — from
  the catalog.

## Not yet in v1 (planned)

- **`SKILL.md` LLM-judge** — an LLM review of instruction text to adjudicate the
  intent behind REVIEW-tier findings (attack vs. defensive mention).
<!-- Fully offline OSV was considered and deliberately not pursued: this is a
     cloud-native project with no air-gap requirement, so the osv.dev lookup is an
     accepted operational dependency (see ESCALATIONS.md #1). -->

