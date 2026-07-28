# SimplyCubed Skills — repo guide

Curated marketplace of **Agent Skills** (the open, cross-tool `SKILL.md` format). Skills are
*referenced, not vendored*: each entry pins an upstream repo at a commit SHA and is certified
in CI. This repo produces three artifacts:

- **`catalog.json`** — the storefront's data source (simplycubed.com/skills).
- **`.claude-plugin/marketplace.json`** — what Claude Code reads on `/plugin marketplace add`.
- **`config/skills/<slug>.scan.json`** — each skill's certification record.

## Working in this repo

- Confirm `git remote -v` is `simplycubed/skills` before acting.
- **Gate-first:** `pnpm gate` is the aggregate local check; CI is authoritative. Per-skill
  scripts: `pnpm scan <slug> [--write]`, `pnpm snapshot <slug> [--write]`, `pnpm generate`,
  `pnpm versions:check`.
- **Never hand-edit** `catalog.json` / `.claude-plugin/marketplace.json` (generated) or
  `config/skills/<slug>.scan.json` (produced by `scan.mjs`) — CI's no-drift + re-scan gates
  reject it.
- Harness standard (goal / gate / loop): [`docs/loop.md`](docs/loop.md).

## Adding a skill

1. Write `config/skills/<slug>.yaml` with a pinned upstream commit SHA.
2. `pnpm scan <slug> --write`
3. `pnpm snapshot <slug> --write`
4. `pnpm generate`, then commit. CI re-verifies against the live upstream bytes.

**Do not hand-set a version** — the YAML has no `version` field. The listing version is
derived from the upstream `SKILL.md`'s `version:` at the pinned SHA (captured by `snapshot`;
must be strict semver or `versions:check` fails). A skill whose upstream declares no version
is unversioned: `version: null` in the catalog, and the plugin manifest omits `version`.

Full runbook: [`docs/adding-skills.md`](docs/adding-skills.md).

## Reference

- Certification methodology: [`METHODOLOGY.md`](METHODOLOGY.md).
- Architecture, infrastructure, and CI: [`docs/`](docs/README.md).
- Consuming `catalog.json`: the authoritative, CI-validated contract is
  [`config/catalog.schema.json`](config/catalog.schema.json) — validate against it and refuse
  a `schemaVersion` you don't understand.
- Storefront sync: a `catalog.json` change on `main` fires
  [`.github/workflows/notify-web.yml`](.github/workflows/notify-web.yml), which rebuilds the
  storefront.
