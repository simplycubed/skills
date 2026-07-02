# SimplyCubed Skills

A curated marketplace of [Claude Agent Skills](https://docs.claude.com/en/docs/claude-code). We scan and verify each skill before listing it, and it's free to install.

> **Status: early and curated.** We import a small, hand-picked set of popular open-source skills, scan each one, and publish the ones that pass. We are not taking open developer submissions yet.

## Install

This repo is a Claude Code plugin marketplace. Add it once, then install any skill:

```
/plugin marketplace add simplycubed/skills
/plugin install <skill-slug>@simplycubed
```

Browse the catalog at [simplycubed.com/skills](https://simplycubed.com/skills).

## What "Scanned & Verified" means (and what it doesn't)

Each listed skill carries an evidence-backed certification, not an absolute guarantee. We publish exactly what we checked, when, and with which tools. The badge makes three separate claims, and we are careful not to let one stand in for the others.

**Integrity.** You install the exact bytes we scanned. We reference the upstream repo pinned to a specific commit (a content hash) and keep a durable snapshot of it.

**Identity.** We show the upstream source, credit the original author, and state the license.

**Safety.** The skill passed our automated static scan on a stated date: secret scanning, static analysis, dependency and license checks, and a review of `SKILL.md` for prompt injection. This is a point-in-time review, re-run on every new version. It lowers risk. It does not prove a skill is safe to run. Skills can still execute code and make network calls, so review anything before you trust it with sensitive access.

Our full methodology is published and versioned, and it describes only the checks we actually run.

## How it works

We reference skills, we don't re-host them. Each catalog entry points at the upstream repo at a pinned commit SHA, and we keep a content-addressed snapshot so a skill stays available and auditable even if the upstream disappears.

Certification is a gate: a skill is listed only after it passes the scan in CI. A new upstream release is a new commit, so it goes back through the scan before we offer it. If a listed skill later turns out to be unsafe, we pull it from the catalog and stop serving its snapshot.

## Contributing

Submissions are curated for now. If you maintain a skill you'd like us to consider, or you're an author who wants attribution fixed or a skill removed, open an issue.

## Licensing

This repository's own code (schema, generators, CI) is MIT licensed; see [LICENSE](LICENSE). Each listed skill keeps its original author's license. We only accept skills under a recognized permissive license and never re-license them. See [NOTICE](NOTICE) for per-skill attribution and licenses.

---

Built by [SimplyCubed](https://simplycubed.com) — an AI automation business.
