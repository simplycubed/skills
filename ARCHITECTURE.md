# Architecture — automated ingestion & certification at scale

The marketplace is moving from a hand-curated handful of skills to **automated
bulk ingestion** (thousands of candidates, largely surfaced via aggregators that
re-bundle others' work). Manual curation does not scale; the directive is that
**automated, complete tests and analysis are the gate** — a human is a rare,
bounded escalation, never a step in the merge path.

This document is the durable plan. It is being implemented in phases; each phase
ships as independently-green PRs.

## The spine

> A verdict is a pure function of **(content bytes) × (analysis logic)**.

Everything follows from that:
- **Content-addressed, cached verdicts.** Key = `contentHash × toolsetHash`. An
  unchanged skill is never re-scanned; CI is bounded by PR size, not catalog size.
- **Verified-provenance bytes.** We resolve every candidate to its *true* source,
  **repoint what we snapshot to those bytes**, verify the real license over them,
  and discard the aggregator's copy — so we scan and redistribute the same,
  provably-permissive bytes.
- **Honest tiered trust.** The badge equals a property the automation actually
  decides; it never claims more.
- **Fail-closed everywhere.** Uncertainty → auto-reject or tier-cap, not a human.

## The gate stages (in order — each feeds the next)

1. **Provenance resolve → repoint to true source** *(ml)* — aggregator taint list →
   embedded attribution (origin claim) → per-file hash / MinHash (corroboration) →
   forge-creation-date tie-break (never attacker-settable git dates). Unresolvable → refuse.
2. **License at source** *(ml)* — real classifiers (askalono fast-pass + ScanCode
   confirmer; must agree, ≥90 score, **every file**, precise dual-license `OR`/`AND`
   rules). Non-permissive / unlicensed / mismatch → refuse. `config.license` is
   derived, never trusted.
3. **Relicense + attribution** *(ml)* — detect aggregator relicensing; derive the
   correct author from source for NOTICE + catalog. Undetermined (for a license that
   requires attribution) → refuse.
4. **Dedup** *(ml)* — content-hash exact + MinHash/LSH near-dup; collapse the same
   skill from N aggregators to one canonical listing.
5. **Security scan** *(security)* over the true-source bytes → derive **trust tier**:
   Unicode/bidi/base64 **obfuscation pre-pass**, injection (regex + corpora), secrets
   (gitleaks), deps (osv), SAST + **capability tagging** (semgrep), **YARA** malware,
   **install-hook** detection, and — for code-bearing skills aspiring to a higher tier
   — **sandboxed dynamic analysis** (egress-denied, syscall-captured). Optional
   **LLM-judge** (bounded to cap/block only; non-answer fails closed) for the top tier.
6. **Snapshot to R2 + cache verdict** *(devops)* — content-addressed blob in R2;
   verdict in KV keyed by `contentHash × toolsetHash`.
7. **Propose PR (≤K skills) → Actions re-verify = trust root → human gate on merge.**
   Adding a skill is a capability grant (gated); the ingestion pipeline only proposes.
8. **Monitor + auto-revoke** *(devops + security policy)* — scheduled OSV re-sweep,
   upstream-liveness, R2 drift, evolving-secret re-scan; each ships a canary that must
   trip every run. Revocation (fail-safe direction) is auto-mergeable.

## Trust tiers (the badge stays honest)

| Tier | Badge | Asserts | Requires |
|---|---|---|---|
| **T0** | (not listed) | — | fails any blocking check |
| **T1 Scanned** | "static checks passed on `<date>`" (not a safety proof) | no known-bad signature/secret/vuln/dangerous-static-capability in these exact bytes | all static blocking checks pass |
| **T2 Verified** | "no dangerous capability" | no executable code, *or* code showed none under sandbox | T1 + (`hasCode==false` OR clean sandbox) |
| **T3 Reviewed** | "reviewed" | LLM-judge adjudicated intent-clean | T2 + clean judge (judge may only cap/block) |

## Phases (status)

- **Phase 0 — raise the floor, in-repo, no new infra:** verdict cache + `certify-diff`;
  static security hardening (obfuscation pre-pass, expanded SAST + capability tags,
  install-hooks, YARA); trust-tier badge. *(pending)*
- **Phase 1 — the legal gate:** provenance resolve + repoint + real license classifiers
  + dedup + eval fixtures. *Until this exists, we do not ingest aggregators.* *(pending)*
- **Phase 2 — scale storage/serving → R2 (IN PROGRESS, see below).** Must land before
  any bulk ingest so GB-scale bytes never enter git history.
- **Phase 3 — higher tiers:** sandbox dynamic analysis (T2) + LLM-judge (T3). *(pending, optional)*
- **Phase 4 — the autonomous miner at scale:** queue/Container ingestion + cron monitors
  + auto-revocation. Safe only because Phases 0–1 built the gate. *(pending)*

## Phase 2 — snapshot bytes off git → R2 (why now, and how)

Git history is permanent: commit GBs once and every clone carries them forever. At
**14 skills (~1 MB)** we migrate now, so the future thousands of blobs never enter
history. Only tiny **trust anchors** stay in git.

- **Git keeps:** skill configs + `snapshots/<slug>/manifest.json` (holds `contentHash`).
- **R2 holds** (one bucket `simplycubed-skills`, prefixed, custom domain
  `cdn.simplycubed.com`): `blobs/sha256/<hex>/unit.tar.gz` (the bytes) +
  `records/sha256/<hex>.json` (the full scan record). Content-addressed → immutable +
  deduped. **Zero egress.**
- **Integrity:** every read fetches the blob, re-hashes the extracted tree, and fails
  closed unless it equals the git manifest's `contentHash`.
- **Auth:** writes via a **single bucket-scoped R2 S3 token** in a `r2-write` GitHub
  Environment (main/dispatch only); the gate reads the bucket's public custom domain
  (no creds, fork-safe — content-addressed URLs are self-verifying). A CDN Worker
  (slug alias + verify-on-serve + revocation 410) is an optional fast-follow, not
  required for the git-bloat fix.

**PR sequence (git-neutral first; deletion last, only after R2 is proven live):**
1. R2 client + round-trip self-test ✅ *(this PR)*
2. `snapshot.mjs` dual-write (git + R2 upload)
3. migration workflow uploads the 14 blobs/records to R2
4. verification reads R2-first, re-hash vs git manifest
5. CDN Worker deploy + custom domain
6. `generate.mjs` record-by-reference + CDN install source + `schemaVersion` 1→2
7. **`git rm -r snapshots/*/unit`** + anti-bloat guard (CI rejects re-committing `unit/`)

## Cost (Cloudflare) — cheap by design

At 10k skills, ≈ **$5–15/month** all-in. Two structural reasons: the repo is
**public → GitHub Actions compute is free** (the scanning), and **R2 has zero egress**
(the serving) with pennies of storage. Content-addressed caching means each unique
skill is scanned exactly once (recurring ≈ $0). The only variable/external cost is the
optional **LLM-judge** (T3) — cheap-model + cached + code-only ≈ $10–100 one-time, $0 if
we skip T3. One-time backlog scan: **$0–low-hundreds**, dominated by that choice.

## Open decisions

- **Run the LLM-judge (T3)?** Skipping it caps code-bearing skills at "Scanned" with
  zero AI cost and no safety loss — a weaker top badge only.
- **Auto-merge revocations**, or require a human reviewer even for removals?
- **Cloudflare Containers vs free Actions** for untrusted-code sandbox isolation.

## Cross-repo contract

The storefront (`simplycubed/web`) consumes `catalog.json`; the `simplycubed-catalog-updated`
`repository_dispatch` contract and `paths: ["catalog.json"]` filter are preserved. The
`schemaVersion` 1→2 bump (record-by-reference) requires a **receiver change owned by the
web repo** — coordinate before merging Phase-2 PR-6.
