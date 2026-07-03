# Escalations

Items the autonomous finish-marketplace loop could not fully resolve and escalated
per the playbook for a maintainer decision. Each says what, why, what was done
instead, and what's needed.

## 1. "certify:active with network fully disabled" — RESOLVED (accept `osv.dev` as an operational dependency)

**What shipped:** Re-verification reads each skill's committed content-addressed
**snapshot** instead of fetching the upstream — so certification has **no
dependency on the upstream repo** (the README's durability promise: a skill stays
available even if upstream disappears). `snapshot:check` enforces snapshot
integrity via content hash. This is the durability guarantee that mattered.

**The "fully network-off" idea was dropped, by design.** The finish-marketplace
playbook set a stretch goal of proving certification needs *zero* network — which
would have meant bundling a local copy of the OSV vulnerability database so the
`osv-scanner` step didn't call `osv.dev`. That only makes sense for an air-gapped
/ on-prem deployment. This is a **cloud-native** stack (GitHub / Neon / Cloudflare)
with no air-gap requirement, so a live `osv.dev` lookup is a normal operational
dependency — the same class as GitHub Actions itself needing the network to fetch
the scanner binaries. **Resolution: accept it; no offline OSV database.**

## 2. semgrep SAST tier (Item 3) — deferred, needs a decision

**What:** Add a `semgrep` static-analysis tier to the scanner suite.

**Why deferred (not shipped):**
- The salvageable invocation from PR #5 is `semgrep scan --config auto`, which
  **downloads rules from the registry at scan time** → network-dependent and
  **non-deterministic**: a skill could pass today and fail tomorrow on a rule
  update with no code change. That contradicts the deterministic, reproducible
  fail-closed gate (and the snapshot's reproducibility guarantee). Shipping it
  as-is would add a *bad* gate.
- **No current value:** the only listed skill (linus-level) contains no code
  (`.md`/`.yaml`/`.png` only) — SAST has nothing to analyze.
- **Couldn't verify locally** (semgrep vs the local Python 3.14), so it couldn't
  be test-first'd before shipping.

**Recommendation:** add semgrep with a **pinned local ruleset** (`--config
./rules/…`, no registry download → deterministic), gated to run only when a
unit actually contains executable code, at the point the first script-bearing
skill is listed. Decision needed: curate/pin a rules file vs. accept `--config
auto`'s non-determinism.

## 3. Commit-hash verification of the fetched tree (Item 4, part a) — deferred

**What:** PR #5 wanted to "verify the checked-out commit hash equals the pin."

**Why deferred:** that assumed a **git-based** fetch (`clone` + `rev-parse`).
This pipeline fetches via `codeload.github.com/<repo>/tar.gz/<sha>`, which is
GitHub's authoritative export of *exactly that commit's tree* and 404s on a bad
SHA — so the fetch already binds to the pinned commit and fails closed. Adding
independent commit-hash recomputation would require switching from the tarball to
a git fetch + comparing tree objects, disproportionate to the marginal assurance.

**Recommendation:** revisit only if we move to a git-based fetch for another
reason. The `--allow-missing-scanners` half of Item 4 IS shipped (see the PR).

_No other escalations open._
