# Infrastructure setup — Cloudflare + GitHub

The complete configuration behind the marketplace, and how to reproduce it. Two providers:
**Cloudflare** (stores + serves the skill bytes) and **GitHub** (CI + the credential vault).

The guiding rule: **Claude proposes; Actions dispose.** No interactive/local process holds
prod credentials. All prod mutations (bucket create, Worker deploy, R2 uploads) run in GitHub
Actions, reading credentials from GitHub **Environments** — never from a developer machine.

---

## Cloudflare

**Account:** `SimplyCubed` — account ID `bfa7c7c2809727c8aa47c47cf652a309`.
(The account also holds the `simplycubed.com` and `simplycubed.dev` zones; skills uses `.com`.)

### Resources

| Resource | Name / value | Created by |
|---|---|---|
| **R2 bucket** | `simplycubed-skills` | `scripts/r2-bootstrap.mjs` (idempotent), run by `provision.yml` |
| **CDN Worker** | `skills-cdn` (`workers/cdn/`) | `wrangler deploy` in `provision.yml` |
| **Custom domain** | `cdn.simplycubed.com` → the Worker | the Worker's `wrangler.jsonc` route (`custom_domain: true`) |

**Object layout in the bucket** (content-addressed by the unit's sha256, `<hex>` = hash without the `sha256:` prefix):
- `blobs/sha256/<hex>/unit.tar.gz` — the skill's published bytes (a gzipped tar).
- `records/sha256/<hex>.json` — the full scan record.

**The CDN Worker** (`workers/cdn/src/index.ts`) serves those two prefixes from the bucket with
`Cache-Control: public, max-age=31536000, immutable` (safe — content-addressed keys never change),
404 on miss, and an opt-in `?verify=1` re-hash for monitoring. R2 has **zero egress cost**, so
serving is effectively free.

### The two API tokens

Both are **standard account API tokens** (My Profile → API Tokens → *Custom token*) — **not** the
R2 → "Manage R2 API Tokens" S3 keys (wrangler doesn't use those here). Scope each to the
`SimplyCubed` account and set an expiration.

**1. Provisioning token** — for the one-time infra build (`provision.yml`, `r2-upload.yml`). Broad:
- Account · **Workers R2 Storage** · Edit
- Account · **Workers Scripts** · Edit
- Account · **Account Settings** · Read
- Zone (`simplycubed.com`) · **Zone** · Read
- Zone (`simplycubed.com`) · **DNS** · Edit
- Zone (`simplycubed.com`) · **Workers Routes** · Edit

> Note: Workers R2 Storage and Workers Scripts are **account-level** permissions — they must sit in
> an *account*-scoped policy, not a zone-scoped one, or R2/Worker API calls fail with auth error 10000.

**2. R2-write token** — for unattended auto-upload on merge (`r2-sync.yml`). Minimal:
- Account · **Workers R2 Storage** · Edit
- Account · **Account Settings** · Read *(so `wrangler whoami` can resolve the account)*

The R2-write token is deliberately narrow: unattended CI can only write/delete content-addressed
blobs in one bucket (all reversible + verified + auto-rolled-back), nothing else.

---

## GitHub (`simplycubed/skills`)

### Environments (Settings → Environments) — the credential vault

| Environment | Secrets | Reviewer | Used by |
|---|---|---|---|
| **`prod`** | `CLOUDFLARE_API_TOKEN` = *provisioning token* · `CLOUDFLARE_ACCOUNT_ID` = `bfa7c7c2809727c8aa47c47cf652a309` | optional (recommended for irreversible ops) | `provision.yml`, `r2-upload.yml` |
| **`r2-write`** | `CLOUDFLARE_API_TOKEN` = *R2-write token* · `CLOUDFLARE_ACCOUNT_ID` = same | **none** (uploads are reversible) | `r2-sync.yml` |

A job's `environment:` key selects which vault its `secrets.*` resolve from — that's how the same
`secrets.CLOUDFLARE_API_TOKEN` reference gets the broad token in `provision` and the narrow one in
`r2-write`. Repo-level secrets are **not** used for Cloudflare.

### Variables (Settings → Secrets and variables → Actions → **Variables** tab)

| Variable | Value | Purpose |
|---|---|---|
| **`R2_AUTOUPLOAD`** | `true` | Bootstrap gate: `r2-sync.yml` runs only when this is `true` (so it stays *skipped*, never failing, until the `r2-write` env exists). |

`R2_AUTOUPLOAD` is a **variable, not a secret** — the workflow gates on `${{ vars.R2_AUTOUPLOAD }}`.

### Repo secrets (Settings → Secrets and variables → Actions → Secrets tab)

| Secret | Purpose |
|---|---|
| **`WEB_DISPATCH_TOKEN`** | Lets `notify-web.yml` fire a `repository_dispatch` to `simplycubed/web` when `catalog.json` changes. A fine-grained PAT with `contents: read` + `metadata` on the web repo (or the org bot). |

### Branch protection (recommended)

`main` requires a PR + green `CI` check; no direct pushes. This is the real gate — everything past
it is a PR, and prod credentials never reach a PR (they live only in the Environments above).

---

## Reproducing it from scratch

1. **Create the two Cloudflare tokens** (scopes above); note the account ID.
2. **Create the GitHub Environments** `prod` and `r2-write`; add `CLOUDFLARE_API_TOKEN` +
   `CLOUDFLARE_ACCOUNT_ID` to each (broad token in `prod`, narrow in `r2-write`).
3. **Run `provision.yml`** (`gh workflow run provision.yml --ref main`, approve the `prod` gate):
   creates the R2 bucket, deploys the CDN Worker, brings up `cdn.simplycubed.com`, smoke-tests it.
4. **Backfill existing blobs**: `gh workflow run r2-upload.yml --ref main` (idempotent).
5. **Enable auto-upload**: set the repo variable `R2_AUTOUPLOAD=true`. New skills' blobs now upload
   on merge via `r2-sync.yml`.
6. Add `WEB_DISPATCH_TOKEN` so storefront rebuilds are triggered on catalog changes.

## Cost

At ~10k skills, ≈ **$5–15/month** all-in: the repo is public (GitHub Actions compute is free), R2
has **zero egress** with pennies of storage, and content-addressed caching means each unique skill
is scanned + stored exactly once.
