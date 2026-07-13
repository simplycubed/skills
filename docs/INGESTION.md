# Ingestion funnel — source discovery → certified skill

How a candidate Agent Skill travels from "somewhere on public GitHub" to a
certified, listed entry in `catalog.json`. This document owns the **top of the
funnel** (discovery + Phase-1 provenance) and how it hands off to the existing
certification pipeline (`scan` → `certify` → `snapshot` → `generate`).

The goal is throughput: grow the marketplace from ~110 skills to thousands by
firing **many** candidate skills at the funnel and auto-keeping only the
high-quality, on-ICP ones.

## Funnel order

Each stage is a filter; a candidate must pass every stage to be ingested.

1. **Discover** (`scripts/discover.mjs`) — find `SKILL.md` files across public
   GitHub via the authenticated `gh` CLI (`gh search code --filename=SKILL.md`
   over several anchor terms, to reach many source repos — not just
   `github/awesome-copilot`). Emits, per candidate:
   `{ repo, sha, path, license, sourceUrl }`, where `sha` is pinned to the repo's
   **current default-branch HEAD** and `path` is the skill **directory** (matching
   `catalog.json`'s `upstream.path` convention).
2. **Phase-1 provenance / license / dedup** (`scripts/phase1.mjs`):
   - **Dedup** against `catalog.json` by `(repo, path)` — skip anything already
     ingested. (Optional finer dedup by SKILL.md content hash behind
     `--content-hash`.)
   - **License / provenance** — keep only permissive SPDX ids (the same allowlist
     `config/skill.schema.json` enforces: MIT, Apache-2.0, BSD-2/3-Clause, ISC,
     0BSD, Unlicense, Zlib). **Fail-closed:** `null` / `NOASSERTION` / GPL / AGPL
     / unknown are rejected.
3. **Structure** — the candidate must be a well-formed skill (valid `SKILL.md`
   frontmatter, sane layout). Enforced today by `scan.mjs` / the unit guards.
4. **Security scan** — `gitleaks` (secrets) + `osv-scanner` (deps) + `semgrep`
   (SAST), over the assembled unit. Owned by `scan.mjs` / `certify.mjs`.
5. **Judge** — the quality + ICP-relevance verdict (`simplycubed/skills-judge`).
   **Not live yet** — stubbed in `funnel-report.mjs`. See the contract below.
6. **Certify → snapshot → generate → PR** — write `config/skills/<slug>.yaml`
   (pinned SHA), `pnpm scan <slug> --write`, snapshot the unit to R2, `pnpm
   generate`, and open a PR. CI re-verifies on the live upstream bytes.
   See [`adding-skills.md`](adding-skills.md).

The **dry-run** funnel (`scripts/funnel-report.mjs`, `pnpm funnel`) runs stages
1–2 and prints the headline counts (found / permissive / new-after-dedup) plus a
sample, writing the full new-candidate list to `candidates.json`. It **stops
before the judge** (stage 5) — no POST — until the judge endpoint is live.

## Cadence + automation intent (NOT yet enabled)

- **Miner workflow:** `.github/workflows/miner.yml` runs the dry-run funnel and
  uploads `candidates.json` as an artifact. It is **DISARMED** —
  `workflow_dispatch`-only; the `schedule:` trigger is committed but **commented
  out**.
- **Intended cadence when armed:** `0 1 * * 1-5` — **01:00 UTC / 10:00 JST,
  weekday mornings** (daily Mon–Fri).
- **Auto-merge-on-green-gate:** the intended end state is that a fully-passing
  candidate (Phase-1 + structure + security + judge `keep`) opens a PR that
  **auto-merges once CI's gate is green**. This is **intent, not yet wired** — no
  auto-merge exists today, and none fires while the cron is disarmed.
- **Arming caveat:** `gh search code` under the default Actions `GITHUB_TOKEN`
  (installation-scoped) may be refused; arming likely needs a user-scoped PAT in a
  repo secret. Decide + populate before uncommenting the schedule.

## Cross-repo judge contract (with `simplycubed/skills-judge`)

`skills` is the **consumer** (a thin client that POSTs candidates); `skills-judge`
is the **producer** (the authenticated judge Worker that holds the rubric + LLM
key). Neither session commits into the other's repo — this contract is the
interface, mirrored in `skills-judge`'s `CLAUDE.md`.

**Request** (per candidate):

```jsonc
{
  "skillMd": "<raw SKILL.md text>",
  "metadata": { "repo": "owner/name", "sha": "<pinned HEAD>", "path": "skills/foo",
                "license": "MIT", "sourceUrl": "https://github.com/…" }
}
```

**Response:**

```jsonc
{
  "icpFit":  0.0,          // 0–1 relevance to the IT/Security SMB ICP
  "quality": 0.0,          // 0–1 skill quality
  "verdict": "keep"        // "keep" | "reject" | "review"
}
```

- **Fail-closed:** only `verdict === "keep"` auto-ingests; `review` / `reject` /
  any error does **not**. Determinism + cost: the judge caches by
  `contentHash × judgeVersion`.
- **Wire-in point:** the `judge()` stub in `scripts/funnel-report.mjs`. Endpoint
  URL + caller auth token land there once the Worker is deployed.
