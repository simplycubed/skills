# Certified Agent Skills — repo guide

Curated marketplace of **Agent Skills** (the open, cross-tool `SKILL.md` format). Skills are
*referenced, not vendored*: each entry pins an upstream repo at a commit SHA and is certified
in CI. This repo produces three artifacts:

- **`catalog.json`** — the storefront's data source (simplycubed.com/skills).
- **`.claude-plugin/marketplace.json`** — what Claude Code reads on `/plugin marketplace add`.
- **`config/skills/<slug>.scan.json`** — each skill's certification record.

## Naming (ratified 2026-07-30)

The `SimplyCubed` prefix names a thing SimplyCubed **authored** — a product, or the certification
program itself. It never attaches to goods SimplyCubed did not write. Third-party goods carry the
**Certified** mark, which names SimplyCubed as verifier, not author. The test before putting the
name on anything: *if this turned out to be bad, would a customer be right to blame us?* If yes,
our name belongs on it; if the blame lands upstream, our name goes on the check.

Applied here:

- This catalog is **Certified Agent Skills**: third-party work, certified by SimplyCubed. All 110
  current entries are authored upstream, and every listing names its author and pinned SHA.
- **SimplyCubed Certified** names the certification program, which *is* ours: the fail-closed
  pipeline, the published scan record, and the mark.
- **SimplyCubed Skills** is reserved for the premium line SimplyCubed authors itself
  ([`simplycubed/premium-skills`](https://github.com/simplycubed/premium-skills)). Do not spend
  that name on this catalog.
- One word for the mark: **certified**, matching `certification.status`. Not "verified".

Addresses are not product names and do not change: the repo path `simplycubed/skills`, the npm
name `@simplycubed/skills`, and the marketplace namespace `simplycubed` are load-bearing in the
install command, every `removalUrl`, and the storefront's catalog fetch.

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
