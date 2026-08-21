# Certification methodology

**Version: v1 (2026-07).** This document describes the checks we run today to
certify a skill. A certified listing means the skill passed these checks on a
stated date, with the tool versions recorded in its `<slug>.scan.json`. That
lowers risk. It does not prove a skill is safe to run. Skills can still execute
code and make network calls, so review anything before you trust it with sensitive
access.

Certification is a **fail-closed gate**. A skill is listed only if every blocking
check passes. CI re-runs the certification against the pinned upstream bytes for
every change, so a committed scan record cannot certify a skill that does not
actually pass.

## What we scan

We certify the **published unit**, which is the exact set of bytes an agent
installs, fetched from the upstream repository at an **immutable commit SHA**,
never a tag or branch. For a skill in a subdirectory, the unit is that
subdirectory. If it has no license of its own, we copy the repository-root
license into the published unit and confirm that the text matches the declared
SPDX identifier.

## The checks

1. **Integrity / structure**: the pinned SHA must resolve to the exact bytes we
   publish. We reject git
   submodules, no Git LFS pointer files, no symlinks that escape the skill root,
   no oversized (non-text) blobs.
2. **License**: a `LICENSE` or `COPYING` file must be present in the published
   unit, and its
   text must match the declared permissive SPDX license. Copyleft or unlicensed
   skills are rejected.
3. **Prompt-injection heuristics** (`SKILL.md` and other instruction text),
   split into two tiers:
   - **Blocking**: action-shaped patterns that are near-always malicious inside
     skill instructions: pipe-to-shell downloads, decode-and-execute, posting
     secrets to a remote, "ignore previous instructions" overrides. Any hit fails
     certification.
   - **Review**: vocabulary legitimate skills routinely use *defensively*
     (credential-file references, exfiltration terms, code-execution APIs). These
     are **surfaced** in the scan record for review, not auto-failed. Intent
     adjudication is not part of certification today.
4. **Secret scanning**: [`gitleaks`](https://github.com/gitleaks/gitleaks) over
   the published bytes. Any leaked credential fails certification.
5. **Dependency vulnerabilities**: [`osv-scanner`](https://github.com/google/osv-scanner)
   over any dependency manifests in the unit, against the OSV database. Known
   vulnerabilities fail certification.
6. **SAST**: [`semgrep`](https://github.com/semgrep/semgrep) over any bundled
   scripts, using a **pinned local ruleset** (`config/semgrep-rules.yml`, never
   `--config auto`) so the result is deterministic and no rules are fetched at scan
   time. Runs only when the unit contains code; a match fails certification.

The exact tool **versions** used for each scan are recorded in that skill's
`<slug>.scan.json` under `tools`, alongside every finding and every review flag,
so the record shows what was checked, when it ran, and which tools produced it.

## Durability and reproducibility

At certification time we record the upstream `{repo, sha, path}` and the content
hash of the exact published unit. We also publish an installable artifact for
those bytes. That keeps a listed skill reproducible and auditable even if its
upstream later disappears or changes outside the pinned commit.

CI re-derives the content hash during verification and fails closed on any mismatch.

## How the gate stays honest

- **Self-test.** CI proves each scanner actually fires: planted-dirty fixtures
  must be flagged and a clean fixture must pass. A gate never seen to go red is a
  false-clear.
- **Re-verification.** CI re-runs the full scan over every active skill. The
  committed `scan.json` is only a display copy. Merge requires the live re-scan to
  still pass.
- **Re-scan on change.** A new upstream release is a new commit + a new snapshot,
  so it goes back through the gate before we offer it.
- **Revocation.** If a listed skill later fails (a newly disclosed vuln, a leaked
  secret), its status flips to `revoked` and we pull it from the catalog.
