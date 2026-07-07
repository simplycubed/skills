# Adding a skill (runbook)

The post-migration flow. A skill is **referenced** at a pinned SHA; its bytes go to R2, never git.

## Prerequisites (one-time)

- The pinned scanners on your PATH (CI uses these exact versions):
  `gitleaks 8.18.4`, `osv-scanner 2.4.0`, `semgrep 1.168.0`. Markdown-only skills don't invoke
  semgrep (it runs only when the unit contains code), so `gitleaks` + `osv-scanner` suffice for those.
- **Auto-upload active** (`R2_AUTOUPLOAD=true` + the `r2-write` env — see
  [infrastructure-setup.md](infrastructure-setup.md)). Without it, a new skill's blob never reaches
  R2 and its `install.folder.source` CDN tarball 404s.

## Steps

1. **Vet the upstream.** Confirm the skill has a real `SKILL.md` at a specific commit and a
   **permissive** license (MIT/Apache-2.0/BSD/ISC). Pick the exact commit SHA (never a branch).

2. **Write `config/skills/<slug>.yaml`** (slug must equal the filename). Minimal shape:
   ```yaml
   slug: my-skill
   name: My Skill
   description: One clear sentence for the storefront.
   version: 1.0.0
   status: active
   upstream:
     repo: owner/repo
     sha: "<full 40-char commit sha>"
     path: skills/my-skill        # omit for a repo-root skill
   author: { name: "Upstream Author", url: "https://github.com/owner/repo" }
   license: MIT
   homepage: https://github.com/owner/repo
   category: devops               # one of: productivity, coding, data, content, research, devops, integration, other
   tags: [aws, incident-response]
   ```

3. **Write the manifest + scan record** (from the pinned upstream — no bytes committed):
   ```sh
   pnpm snapshot <slug> --write   # writes snapshots/<slug>/manifest.json (manifest-only)
   pnpm scan <slug> --write       # writes config/skills/<slug>.scan.json (needs scanners)
   ```
   The scan must come back **certified** (0 blocking findings) and `licenseMatches: true`.

4. **Regenerate + gate:**
   ```sh
   pnpm generate      # updates catalog.json + marketplace.json
   pnpm gate          # full local gate (scanner steps run if the binaries are on PATH)
   ```

5. **PR it.** Commit the `.yaml`, `snapshots/<slug>/manifest.json`, `config/skills/<slug>.scan.json`,
   and the regenerated `catalog.json` + `marketplace.json`. CI re-verifies the skill by
   **reproducing it from the pinned upstream** (its blob isn't in R2 yet) and re-running the scan.

6. **Merge.** On merge, `r2-sync` reproduces the skill from upstream, uploads its blob + record to
   R2, and CDN-re-hash-verifies (rolling back on failure). `notify-web` fires and the storefront
   rebuilds. The install link is now live.

## Notes & guardrails

- **Never commit a `snapshots/*/unit` tree** — the anti-bloat guard rejects it. `snapshot --write` is
  manifest-only by design; assembly scratch lives in the OS temp dir and self-cleans.
- **> 5 MB unit** → `snapshot` escalates rather than proceeding (a storage decision, not an inline commit).
- A **catalog-shape change** (new fields) requires a `schemaVersion` bump coordinated with the web repo;
  adding skills does **not** change the shape, so no coordination is needed.
- To source many candidates safely, prefer already-vetted collections (e.g. `github/awesome-copilot`)
  at a single pinned SHA.

## Revoking a skill

`pnpm revoke <slug>` flips status and drops it from both manifests; a `revoked` skill is delisted.
