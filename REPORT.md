# Finish-marketplace loop — completion report

Autonomous, gate-driven completion of the remaining marketplace features
(goal: `~/.claude/goals/finish-skills-marketplace.md`). Every change shipped as a
PR that passed CI before merge; no gate was ever weakened to pass.

## Outcome by item

| Item | Status | PR |
| --- | --- | --- |
| **1 — Test hardening** (P1) | ✅ shipped | #9 |
| **2 — Content-addressed snapshot** (P0) | ✅ shipped | #10 |
| **3 — semgrep SAST** (P2) | 📋 escalated | — |
| **4 — Salvage PR #5** (P2) | ✅ partial (flag shipped, hash-verify escalated) | #11 |
| **5 — Revocation tooling** (P2) | ✅ shipped | this PR |

## What shipped

- **Gap-audit tests closed** — hermetic tests for the previously-untested paths:
  license mislabel (declared vs actual SPDX) fails closed; a missing required
  scanner fails closed; REVIEW-tier vocabulary passes with findings surfaced;
  the validator rejects copyleft/bad-slug/missing-field; every structure guard
  fires. (`unit:selftest`, extended `gate:selftest`.)
- **Content-addressed snapshot** — each certified skill's exact unit is vendored
  under `snapshots/<slug>/` with a hashed manifest; `certify:active` re-verifies
  the **snapshot, not the upstream**, so certification survives an upstream that
  disappears. `snapshot:check` enforces integrity. `install.folder.source` now
  points at the durable snapshot.
- **`--allow-missing-scanners`** dev flag — a skipped scanner marks the record
  `incomplete`, which is **never** shown as certified; CI stays fail-closed.
- **Revocation tooling** — `revoke <slug>` flips config status to `revoked` and
  removes the snapshot; revoked skills drop out of both manifests. `revoke:selftest`
  proves it.

## What was escalated (see `ESCALATIONS.md`) — decisions for Charles

1. **semgrep SAST** — the salvageable `--config auto` is non-deterministic
   (registry download; verdict can flip with no code change) and the only listed
   skill has no code; wants a **pinned local ruleset**. Not shipped rather than
   add a non-deterministic gate.
2. **Commit-hash verification of the fetched tree** — `codeload …/tar.gz/<sha>`
   already binds to the exact commit tree and 404s on a bad SHA; independent
   recomputation needs a git-based fetch, disproportionate.
3. **Fully network-off re-scan** — the snapshot removes the *upstream* dependency
   (the README's promise); a fully air-gapped re-scan additionally needs a bundled
   offline OSV database. Decision: bundle it, or accept `osv.dev` as an operational
   dependency.

## Out of scope (left planned, as the goal specified)
- `SKILL.md` LLM-judge (needs an API credential + design).
- Catalog CDN / published endpoint (hosting decision + creds).
- Additional skill listings (a curation decision).

## Completion gate
On `main`: `validate`, `gate:selftest`, `unit:selftest`, `scan:selftest`,
`generate:selftest`, `generate:check`, `catalog:check`, `snapshot:check`,
`revoke:selftest`, and `certify:active` (re-verifying from the snapshot) all pass.
P0 + P1 shipped; every P2 item shipped or escalated with a reason.
