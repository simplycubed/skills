# Certified Agent Skills

A curated marketplace of [Agent Skills](https://agentskills.io), the open `SKILL.md`
format used by Claude Code, OpenAI Codex, Gemini CLI, and other compatible agents.
SimplyCubed does not author the third-party skills listed here. Each listing points
to the upstream source at a pinned commit and publishes a certification record for
the exact bytes we reviewed.

> **Status: early and curated.** We publish a small set of hand-picked open-source
> skills today. If you maintain a skill you want reviewed, open an issue.

## Install

Every listed skill is a plain `SKILL.md` folder in the open Agent Skills format, so it installs into any compatible agent — Claude Code, OpenAI Codex, Gemini CLI, Cursor, and others.

**Any agent (vendor-neutral).** Install the skill folder into your agent's skills directory. The `.agents/skills/` path is the interop location that Codex and Gemini CLI read directly:

| Agent | Project scope | Global scope |
| --- | --- | --- |
| Vendor-neutral | `.agents/skills/` | `~/.agents/skills/` |
| Claude Code | — | `~/.claude/skills/` |
| OpenAI Codex | `.agents/skills/` | `~/.agents/skills/` |
| Gemini CLI | `.gemini/skills/` or `.agents/skills/` | `~/.gemini/skills/` or `~/.agents/skills/` |

**Claude Code (one command).** SimplyCubed is also a Claude Code plugin marketplace, so you can install without touching the filesystem:

```
/plugin marketplace add simplycubed/skills
/plugin install <skill-slug>@simplycubed
```

Browse the catalog at [simplycubed.com/skills](https://simplycubed.com/skills).

## Marketplace outputs

This repository is the public source of truth for the marketplace data it publishes.

- `catalog.json` is the storefront data source.
- `.claude-plugin/marketplace.json` is the Claude Code marketplace manifest.
- `config/skills/<slug>.scan.json` records the certification result for each listed skill.
- `config/catalog.schema.json` defines the consumer contract for `catalog.json`.

## What "Certified" means

Each listed skill carries an evidence-backed certification, not an absolute guarantee.
We publish what we checked, when we checked it, and which tools produced the result.

- **Integrity.** The listing is pinned to a specific upstream commit, and the published
  install artifact matches the bytes we scanned.

- **Identity.** We name the upstream source, credit the original author, and publish
  the declared license.

- **Safety.** The skill passed our automated certification checks on a stated date.
  Those checks include license validation, secret scanning, dependency checks,
  static analysis for bundled code, and prompt-injection review of `SKILL.md`.
  This lowers risk. It does not prove a skill is safe to run. Skills can still
  execute code and make network calls, so review anything before you trust it
  with sensitive access.

Our [methodology](METHODOLOGY.md) describes the checks we run today.

## Warning Exceptions

Most listed skills are cleanly certified. A small number of high-value skills may
instead be listed with a **warning** when they contain a specific, understood
instruction we want to keep visible rather than silently rewrite or label as
clean certification.

When that happens:

- the skill page carries a public warning explaining the issue and our recommendation;
- the plugin metadata carries a short warning line in the description so tool users can still see the risk in compact UIs;
- the catalog marks the skill as `warning`, not `certified`;
- the exception is narrow and explicit: only the named finding(s) for that one skill are allowed;
- certification still runs on the exact published bytes.

This lane exists for edge cases such as a useful upstream skill that includes an
instruction we recommend handling manually instead. It is not a general bypass
for failed scans.

## How it works

Each listing points to an upstream repository at a pinned commit SHA. We also
publish an installable artifact for the exact bytes we certified so the listing
stays reproducible and auditable even if the upstream changes later.

Certification is a gate. A skill is listed only after it passes the checks in CI.
A new upstream release is a new commit, so it goes back through certification
before we offer it. If a listed skill later turns out to be unsafe, we can delist
it and stop serving its published artifact.

See [`docs/`](docs/README.md) for the public docs set, including the certification
methodology, the artifact contract, and the add/update guide.

## Contributing

Submissions are curated for now. If you maintain a skill you'd like us to consider,
or you're an author who wants attribution fixed, open an issue.

**Are you the author of a listed skill and want it removed?** Every skill page has a **Request removal** link, or use the [skill removal request form](https://github.com/simplycubed/skills/issues/new?template=skill-removal.yml) directly. It collects proof of ownership; on a verified request we pull the skill from the catalog and stop serving its snapshot.

## Licensing

This repository's own code, including the schema, generators, and CI configuration,
is MIT licensed. See [LICENSE](LICENSE). Each listed skill keeps its original
author's license. We only accept skills under a recognized permissive license and
never re-license them. See [NOTICE](NOTICE) for per-skill attribution and licenses.

---

Built by [SimplyCubed](https://simplycubed.com), an AI automation business.
