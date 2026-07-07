# SimplyCubed Skills — documentation

Operational + architectural docs for the certified Agent Skills marketplace.

| Doc | What it covers |
|---|---|
| [infrastructure-setup.md](infrastructure-setup.md) | **The full Cloudflare + GitHub config** — R2 bucket, CDN Worker, the two API tokens and their exact scopes, GitHub Environments/secrets/variables, and how to reproduce it from scratch. |
| [architecture.md](architecture.md) | How the content-addressed R2 snapshot store works: bytes flow, verification (`materializeUnit`), fail-closed integrity, why bytes live in R2 not git. |
| [adding-skills.md](adding-skills.md) | The runbook for adding a skill (post-migration): config → snapshot → scan → generate → PR → merge → auto-upload. |
| [workflows.md](workflows.md) | Every GitHub Actions workflow — triggers, what it does, which credentials it uses, when to run it manually. |

See also, at the repo root: `ARCHITECTURE.md` (the scale/ingestion design), `METHODOLOGY.md`
(certification methodology), `ESCALATIONS.md` (open human tasks), and `CLAUDE.md` (repo guide
+ the web-storefront contract).

## The 10-second mental model

- Each skill is **referenced** (an upstream repo + a **pinned commit SHA** + a subpath), not vendored.
- We assemble the exact published bytes ("the unit"), **content-hash** them, scan them, and store:
  - the **bytes** as a content-addressed tarball in **Cloudflare R2**, served at `cdn.simplycubed.com`;
  - a tiny **`snapshots/<slug>/manifest.json`** trust anchor (the hash + upstream) in **git**;
  - the **scan record** at `config/skills/<slug>.scan.json`.
- Two generated, committed artifacts: **`catalog.json`** (the storefront) and
  **`.claude-plugin/marketplace.json`** (Claude Code).
- Verification is **fail-closed**: every read re-hashes the bytes against the git manifest.
