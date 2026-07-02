# SimplyCubed Skills

A curated marketplace of **Claude Agent Skills**, each scanned and verified by SimplyCubed before it's
listed. Free to install.

> **Status: early / curated.** We import a small, hand-picked set of popular open-source skills, run each
> through an automated security scan, and publish the ones that pass. Open developer submissions are not
> open yet.

## Install

This repo is a [Claude Code plugin marketplace](https://docs.claude.com/en/docs/claude-code). Add it once,
then install any skill:

```
/plugin marketplace add simplycubed/skills
/plugin install <skill-slug>@simplycubed
```

Browse the catalog at [simplycubed.com/skills](https://simplycubed.com/skills).

## What "Scanned & Verified" means (and what it doesn't)

Every listed skill carries an evidence-backed certification, not an absolute guarantee. We publish exactly
what we checked, when, and with what tools. The badge is **three separate claims** — we never let one imply
the others:

- **Integrity** — you install the exact bytes we scanned. We reference the upstream repo pinned to a specific
  commit (a content hash), and keep a durable snapshot of that commit.
- **Identity** — we show the upstream source, the original author (credited), and its license.
- **Safety** — the skill passed our automated static scan (secret scanning, static analysis, dependency
  and license checks, and a review of `SKILL.md` for prompt-injection) on a stated date. This is a
  point-in-time static review, re-run on every new version. **It reduces risk; it does not prove a skill is
  safe to run.** Skills can still execute code and make network calls. Review anything before you trust it
  with sensitive access.

The full methodology is published and versioned. We describe only the checks we actually run.

## How it works

- **Reference, not re-hosting.** We don't republish authors' source. Each catalog entry references the
  upstream repo at a pinned commit SHA; we keep a content-addressed snapshot for availability, revocation,
  and audit.
- **Certification is a gate.** A skill is listed only after it passes the scan in CI. A new upstream release
  is a new commit, which re-enters the scan before it can be offered.
- **Revocation.** If a listed skill is later found unsafe, we pull it from the catalog and stop serving its
  snapshot.

## Contributing

Submissions are curated for now. If you maintain a skill you'd like considered, or you're an author who wants
attribution corrected or a skill removed, open an issue.

## Licensing

- **This repository's own code** (schema, generators, CI) is licensed **MIT** — see [LICENSE](LICENSE).
- **Each listed skill keeps its original author's license.** We only accept skills under a recognized
  permissive license and never re-license them; see [NOTICE](NOTICE) for per-skill attribution and licenses.

---

Built by [SimplyCubed](https://simplycubed.com) — an AI automation studio.
