# Adding or updating a skill

This guide covers the public maintainer workflow for adding a new skill or updating
an existing one.

## Prerequisites

- The required scanners must be available on your `PATH` when you run the local gate.
- The upstream skill must have a real `SKILL.md` at a pinned commit SHA.
- The upstream license must be permissive.

## Steps

1. **Vet the upstream.** Confirm the skill has a real `SKILL.md` at a specific
   commit and a permissive license such as MIT, Apache-2.0, BSD, or ISC. Pick the
   exact commit SHA, never a branch.

2. **Write `config/skills/<slug>.yaml`**. The slug must match the filename. Minimal shape:
   ```yaml
   slug: my-skill
   name: My Skill
   description: One clear sentence for the storefront.
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

   Do not hand-set `version` in YAML. The listing version is derived from the
   upstream `SKILL.md` at the pinned SHA.

3. **Write the manifest and scan record**:
   ```sh
   pnpm snapshot <slug> --write
   pnpm scan <slug> --write
   ```

   `pnpm snapshot` writes `snapshots/<slug>/manifest.json`. `pnpm scan` writes
   `config/skills/<slug>.scan.json`.

4. **Regenerate and run the gate:**
   ```sh
   pnpm generate
   pnpm gate
   ```

5. **Open a PR.** Commit the YAML config, `snapshots/<slug>/manifest.json`,
   `config/skills/<slug>.scan.json`, and the regenerated marketplace artifacts.
   CI re-verifies the skill against the pinned upstream bytes and re-runs the scan.

6. **Merge.** After merge, repository automation publishes the updated artifacts.

## Notes & guardrails

- **Never commit a `snapshots/*/unit` tree.** Only the manifest belongs in git.
- A skill whose upstream declares no version is intentionally unversioned. It will
  appear as `version: null` in the generated catalog.
- A breaking catalog shape change requires a `schemaVersion` bump in
  `config/catalog.schema.json`.
- If you are sourcing many candidates, prefer already-vetted collections at a
  single pinned SHA.

## Warning exceptions

The default rule is simple: a listed skill should pass clean certification. A
small number of named, high-value skills may stay listed with a public warning
when all of these conditions hold:

- the blocking finding is specific and understood;
- we want to preserve the upstream bytes rather than silently rewrite them;
- the risk is acceptable as a visible warning, not a hidden bypass;
- the config explicitly names the exact blocking finding(s) allowed for that one skill.

Use the optional `warning` block in `config/skills/<slug>.yaml` only for those exception cases:

```yaml
warning:
  title: Install manually
  summary: Install the prerequisite directly from the vendor docs before using this skill.
  message: >-
    This upstream skill includes installation guidance we recommend handling manually.
    Install the prerequisite directly from the vendor's official documentation before using this skill.
  recommendation: Confirm the prerequisite is installed, then use the skill.
  allowedFindings:
    injection:
      - SKILL.md: pipe-to-shell download
```

Rules for this lane:

- it is per-skill, never global;
- the warning text is public and intended for both the storefront and compact plugin UIs;
- `allowedFindings` must match the live blocking finding(s) exactly;
- the catalog will mark the skill `warning`, not `certified`;
- any extra or changed blocking finding still fails the gate.

## Revoking a skill

`pnpm revoke <slug>` flips status and drops the skill from the published manifests.
A `revoked` skill is delisted.
