# Escalations

Items the autonomous finish-marketplace loop could not fully resolve and left for
Charles. Each says what, why, what was done instead, and what's needed.

## 1. "certify:active with network fully disabled" — partially met (deliberate deviation)

**Goal wording:** Item 2's gate asked that `certify:active` pass "with network
egress disabled (prove no live dependency)."

**What shipped:** Re-verification now reads each skill's committed
content-addressed **snapshot** instead of fetching the upstream — so there is **no
dependency on the upstream repo** (the README's actual durability promise: a skill
stays available even if upstream disappears). `snapshot:check` enforces snapshot
integrity via content hash.

**Not done, and why:** Two network needs remain in the `certify` CI job: (a) the
OSV vulnerability lookup consults `osv.dev`, and (b) the scanner binaries are
downloaded at job start. Truly disabling network egress in GitHub Actions to
*prove* independence is brittle, and offline-OSV requires bundling/caching the OSV
database — a meaningful chunk of its own. I did **not** fake or weaken the gate to
claim "network disabled."

**What's needed from Charles:** a decision on whether to invest in a bundled/cached
offline OSV database (for a fully air-gapped re-scan) or accept `osv.dev` as an
operational dependency (same class as the scanner-binary download). Tracked in
METHODOLOGY.md under "Not yet in v1 → Fully offline OSV."

_No other escalations yet._
