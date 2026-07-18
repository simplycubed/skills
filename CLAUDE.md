# SimplyCubed Skills — repo guide

Curated marketplace of **Agent Skills** (the open, cross-tool `SKILL.md` format).
Skills are *referenced, not vendored*, at a pinned upstream commit SHA and
certified in CI. This repo produces three artifacts:

- **`catalog.json`** — the storefront's data source (simplycubed.com/skills).
- **`.claude-plugin/marketplace.json`** — what Claude Code reads on `/plugin marketplace add`.
- **`config/skills/<slug>.scan.json`** — each skill's certification record.

## Working in this repo (skills session)

- **One Claude session owns this repo** at a time. Confirm `git remote -v` is
  `simplycubed/skills` before acting; if HEAD/branch moves without your action,
  another session may have strayed in — stop and flag it.
- **Gate-first.** Scripts: `pnpm validate` · `gate:selftest` · `scan <slug> [--write]`
  · `scan:selftest` · `certify:active` · `snapshot [--write]` · `snapshot:check` ·
  `versions:check` · `versions:selftest` · `generate` · `generate:check` ·
  `generate:selftest` · `catalog:check`.
- **Add a skill:** write `config/skills/<slug>.yaml` (pinned SHA) → `pnpm scan <slug> --write`
  → `pnpm snapshot <slug> --write` → `pnpm generate` → commit. CI re-verifies on the live
  upstream bytes. **Do NOT hand-set a version** — there is no `version` field in the YAML.
  The listing version is DERIVED from the upstream `SKILL.md`'s `version:` at the pinned SHA
  (captured into the snapshot manifest by `snapshot`; must be strict semver or `versions:check`
  fails). A skill whose upstream declares no version is **unversioned** (catalog `version: null`;
  the plugin manifest omits `version`, so Claude Code falls back to the commit SHA).
- **Never hand-edit** `marketplace.json` / `catalog.json` (generated) or
  `<slug>.scan.json` (produced by `scan.mjs`) — CI's no-drift + re-scan gates reject it.
- Certification methodology: [`METHODOLOGY.md`](METHODOLOGY.md).
- **Storefront sync (skills → web):** when `catalog.json` changes on `main`,
  `.github/workflows/notify-web.yml` fires a `repository_dispatch`
  (`simplycubed-catalog-updated`) to `simplycubed/web`, which rebuilds the
  storefront against the live catalog. This repo owns the **sender**; the web repo
  owns the receiver + the build-time live fetch (see the web repo's CLAUDE.md
  "storefront catalog sync"). Auth is the `WEB_DISPATCH_TOKEN` secret (Charles
  populates it). Neither session commits into the other's repo.

---

# ⇄ Contract for the web storefront — SHARE THIS SECTION WITH THE WEB-REPO SESSION

The skills repo is the producer; the web storefront is the consumer. The interface
is **`catalog.json`**. Everything below is what the web session needs; nothing else
in this repo is part of the contract.

## Fetching it
- Lives at the repo root on `main`. For v1, fetch raw:
  `https://raw.githubusercontent.com/simplycubed/skills/main/catalog.json`.
  (A CDN'd / published endpoint is a later step — coordinate before hard-coding a
  different URL.)
- The shape is defined and CI-validated against **`config/catalog.schema.json`**
  (JSON Schema draft-07). Validate against it; **refuse a `schemaVersion` you don't
  understand.**

## Top-level shape
```json
{ "schemaVersion": 3, "marketplace": "simplycubed", "skills": [ /* Skill */ ] }
```
`schemaVersion` is bumped on any breaking shape change. **v3 (current)** made `version`
**`string | null`**: it is now the UPSTREAM-declared version at the pinned SHA, or `null`
for an **unversioned** skill (upstream declares none) — never a fabricated default. (v2
changed `install.folder.source` to a durable content-addressed CDN tarball; v1 was the
initial shape.)

## Each `Skill`
`slug`, `name`, `description`, `version` (**string | null**), `category` (string|null),
`tags` (string[]), `author` ({name, url?}), `license` (SPDX id), `upstream` ({repo, sha, path?}),
`sourceUrl`, `tier` (`"free"` | `"premium"`), `removalUrl`, `install`, `certification`.

**`version`** — the SemVer version declared by the upstream `SKILL.md` at the pinned
`upstream.sha`, or **`null`** when the skill is unversioned. We never invent one. **Render
the string when present; when `null`, show no version (e.g. an "Unversioned" badge) and
SORT/secondary-sort that skill by `certification.scannedAt`** rather than by version. A
skill's version changes only when its pinned SHA moves to an upstream release that declares
a new version.

**`removalUrl`** — a deep link to a pre-filled GitHub issue form for the skill's
author/rights-holder to request removal (the form collects ownership proof).
Render it as a small **"Request removal"** link on each skill's page.

**`tier`** — `"free"` today for every skill. `"premium"` is the seam for future
subscription-gated skills: a premium skill is listed in `catalog.json` (render a
badge + a subscribe CTA) but is **omitted from the public plugin manifest** and its
bytes are **not** in this public repo — it'll be delivered by a separate entitlement
service. Don't render free install commands for a `premium` skill.

## `install` — render this; it IS the multi-provider pitch
```jsonc
"install": {
  "claudeCode": { "marketplaceAdd": "/plugin marketplace add simplycubed/skills",
                  "command": "/plugin install <slug>@simplycubed" },
  "folder": {
    "dirName": "<slug>",
    "source": "https://cdn.simplycubed.com/blobs/sha256/<hash>/unit.tar.gz", // durable CDN tarball (download + extract)
    "targets": [ { "agent": "Vendor-neutral (Codex, Gemini CLI, …)", "dir": ".agents/skills/" },
                 { "agent": "Claude Code", "dir": "~/.claude/skills/" },
                 { "agent": "Gemini CLI",  "dir": "~/.gemini/skills/" } ]
  }
}
```
- `claudeCode` → show the two commands.
- `folder` → "download the `.tar.gz` at `source` and **extract** it into your agent's
  skills directory," rendering `targets` as an agent → directory table. (`source` is a
  content-addressed archive, not a browsable tree — present it as download-and-extract.)
  This is what makes a skill installable in **any** SKILL.md-aware agent, not just Claude Code.

## `certification` — render the badge
```jsonc
"certification": {
  "status": "certified",           // "certified" | "revoked" | "pending"
  "scannedAt": "2026-07-02T…Z",    // ISO-8601, or null when pending
  "record": { /* full scan record, or null when pending */ }
}
```
For the "what we checked" detail, read from `record`:
- `record.tools` — map of tool → version actually run (e.g. `gitleaks`, `osv-scanner`).
- `record.checks` — `structure` / `license` / `injection` / `secrets` / `vulnerabilities`; **empty array = clean**.
- `record.review` — surfaced, **non-blocking** flags (e.g. defensive security vocabulary). Show as "flagged for review," not as failures.
- Link "how it's certified" to `METHODOLOGY.md` in this repo.

## Rules for the storefront
- **Only** skills in `catalog.json` are listed (the repo emits only `status: active` skills).
- Treat `catalog.json` as **read-only, generated** — never write back.
- **Freshness:** use per-skill `certification.scannedAt` or the file's git commit time.
  There is deliberately **no top-level `generatedAt`** (it would break the repo's
  no-drift gate).
- A `revoked` skill must be delisted or clearly badged — never shown as certified.

## Now available (v3)
- **Upstream-sourced version (BREAKING — schemaVersion 3)** — `version` is now the
  version declared by the upstream `SKILL.md` at the pinned SHA, or **`null`** for an
  unversioned skill. **The web receiver must:** accept `schemaVersion: 3`; render a `null`
  `version` as no-version / an "Unversioned" badge; and sort (or secondary-sort) unversioned
  skills by `certification.scannedAt` instead of by version. No other shape change.

## Now available (v2)
- **Snapshot download** — the durable content-addressed snapshot is **live**:
  `install.folder.source` points at `https://cdn.simplycubed.com/blobs/sha256/<hash>/unit.tar.gz`
  (served from R2, byte-stable even if upstream disappears). It's a `.tar.gz` to
  **download + extract**, not a browsable tree — the storefront must present it that way.

## Not yet available (don't build UI that depends on these)
- **semgrep SAST** and the **`SKILL.md` LLM-judge** are planned, not in v1.
- **Record-by-reference + trust-tier badge** — proposed for a future schemaVersion
  (embedded `certification.record` today; a `certification.trustTier` T0–T3 field and a
  CDN `recordUrl` are the seam). Don't build UI against them until the version bumps.
