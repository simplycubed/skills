# simplycubed/skills

- `AGENTS.md` is the repo-local source of truth for agent instructions. Keep `CLAUDE.md` as a thin shim that imports this file; do not maintain duplicate guidance in both places.
- Ignore `.claude/worktrees/` during repo exploration. It contains Claude scratch worktrees, not the live project.

## Purpose

- Curated marketplace of **Agent Skills** using the open, cross-tool `SKILL.md` format.
- Skills are referenced, not vendored: each listing pins an upstream repo at a commit SHA and is certified in CI.
- This repo produces three primary artifacts:
- `catalog.json` for the storefront data source.
- `.claude-plugin/marketplace.json` for Claude Code's marketplace installer.
- `config/skills/<slug>.scan.json` for each skill's certification record.

## Naming

- The `SimplyCubed` prefix is reserved for things SimplyCubed authored: a product, or the certification program itself.
- Third-party goods in this catalog carry the **Certified** mark because SimplyCubed is the verifier, not the author.
- This catalog is **Certified Agent Skills**. Do not rename it to imply SimplyCubed authored upstream skills.
- `SimplyCubed Skills` is reserved for the premium line SimplyCubed authors itself: [`simplycubed/premium-skills`](https://github.com/simplycubed/premium-skills).
- Use **certified** to match `certification.status`; do not switch terminology to "verified".
- Repo/package/namespace addresses are load-bearing and do not change casually: `simplycubed/skills`, `@simplycubed/skills`, and marketplace namespace `simplycubed`.

## Commands

- Confirm `git remote -v` points at `simplycubed/skills` before acting.
- `pnpm gate` is the aggregate local gate; CI is authoritative.
- `pnpm scan <slug> [--write]` runs certification for one skill.
- `pnpm snapshot <slug> [--write]` captures upstream listing metadata from the pinned revision.
- `pnpm generate` regenerates derived outputs, including `catalog.json` and `.claude-plugin/marketplace.json`.
- `pnpm versions:check` verifies catalog version data against pinned upstream `SKILL.md` files.

## Generated And Certified Artifacts

- Never hand-edit `catalog.json` or `.claude-plugin/marketplace.json`; they are generated artifacts and CI enforces no-drift.
- Never hand-edit `config/skills/<slug>.scan.json`; `scan.mjs` produces it and CI re-scans against live upstream bytes.
- If a change affects derived outputs, run `pnpm generate` and include the regenerated files in the same change.
- The harness pattern for this repo follows `docs/loop.md`.

## Adding Or Updating Skills

1. Write or edit `config/skills/<slug>.yaml` with a pinned upstream commit SHA.
2. Run `pnpm scan <slug> --write`.
3. Run `pnpm snapshot <slug> --write`.
4. Run `pnpm generate`.

- Do not hand-set a version in YAML. The listing version is derived from the upstream `SKILL.md` `version:` field at the pinned SHA.
- Upstream versions must be strict semver or `pnpm versions:check` fails.
- A skill whose upstream declares no version is intentionally unversioned: `version: null` in the catalog, and the plugin manifest omits `version`.
- Full runbook: `docs/adding-skills.md`.

## Current Slack Import Coordination

- Parallel-session split for the `slackapi/slack-skills-plugin` import is active.
- Charles re-read `AGENTS.md` in the live repo and, for this work, the session note below is the coordination source to follow.
- Session A lane: scanner/policy/catalog-system changes only.
- Files touched or intended by Session A:
  - `scripts/scan.mjs`
  - `scripts/unit-selftest.mjs`
  - `config/skill.schema.json`
  - `scripts/generate.mjs`
  - `config/catalog.schema.json`
  - `scripts/certify-active.mjs`
  - `scripts/generate-selftest.mjs`
  - `README.md`
  - `docs/adding-skills.md` (possible)
- Session A is implementing:
  - a warning-exception system for explicitly approved edge-case skills
  - the narrow `slack-api` placeholder bearer-token false-positive fix
- Session A should avoid editing the per-skill Slack import artifact files while Session B is active.
- Session B lane: Slack import artifact files only.
- Files owned by Session B:
  - `config/skills/block-kit.yaml`
  - `config/skills/block-kit.scan.json`
  - `config/skills/create-slack-app.yaml`
  - `config/skills/create-slack-app.scan.json`
  - `config/skills/slack-api.yaml`
  - `config/skills/slack-api.scan.json`
  - `config/skills/slack-cli.yaml`
  - `config/skills/slack-cli.scan.json`
  - `config/skills/slack-messaging.yaml`
  - `config/skills/slack-messaging.scan.json`
  - `config/skills/slack-search.yaml`
  - `config/skills/slack-search.scan.json`
  - `snapshots/block-kit/manifest.json`
  - `snapshots/create-slack-app/manifest.json`
  - `snapshots/slack-api/manifest.json`
  - `snapshots/slack-cli/manifest.json`
  - `snapshots/slack-messaging/manifest.json`
  - `snapshots/slack-search/manifest.json`
- Generated outputs should only be regenerated once the owning session is ready, to avoid churn:
  - `catalog.json`
  - `.claude-plugin/marketplace.json`
- Current known state from Session A:
  - `slack-api` now certifies cleanly after the narrow placeholder-token filter
  - `slack-cli` remains blocked on `SKILL.md: pipe-to-shell download`
  - Session A stopped before finishing docs
  - Session A stopped before wiring warning text into plugin descriptions

## Cross-Repo Contract

- `catalog.json` is the authoritative artifact consumed by `simplycubed/web` for the storefront.
- Treat `config/catalog.schema.json` as the compatibility contract for catalog consumers.
- If you need a breaking catalog shape change, coordinate it through `schemaVersion` rather than shipping silent shape drift.
- A `catalog.json` change on `main` triggers `.github/workflows/notify-web.yml`, which notifies `simplycubed/web` to rebuild the storefront.

## Reference

- Certification methodology: `METHODOLOGY.md`.
- Architecture, infrastructure, and CI docs: `docs/README.md`.
- Catalog consumer contract: `config/catalog.schema.json`.
- Skill onboarding runbook: `docs/adding-skills.md`.
