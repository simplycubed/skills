# Certified Agent Skills documentation

Public documentation for the Certified Agent Skills marketplace.

| Doc | What it covers |
| --- | --- |
| [`../README.md`](../README.md) | Marketplace overview, install options, certification summary, and contributor entry points. |
| [`../METHODOLOGY.md`](../METHODOLOGY.md) | The certification checks we run today and what the resulting status means. |
| [`adding-skills.md`](adding-skills.md) | How to add or update a skill in this repository. |
| [`../config/catalog.schema.json`](../config/catalog.schema.json) | The consumer contract for `catalog.json`. |

## Public artifact model

- `catalog.json` is the authoritative storefront data source.
- `.claude-plugin/marketplace.json` is the Claude Code marketplace manifest.
- `config/skills/<slug>.scan.json` records certification results for listed skills.
- `snapshots/<slug>/manifest.json` records the upstream pin and content hash for the
  published unit.
