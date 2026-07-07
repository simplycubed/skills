# GitHub Actions workflows

Every workflow, what it does, its triggers, and the credentials it uses. Credentials come from
GitHub **Environments** (see [infrastructure-setup.md](infrastructure-setup.md)); nothing holds prod
credentials outside Actions.

| Workflow | Trigger | Env / creds | What it does |
|---|---|---|---|
| **`ci.yml`** | PR + push to `main` | none | The gate. `gate` job: validate, self-tests, no-drift, catalog contract, snapshot integrity (reads R2/upstream), bloat guard. `certify` job: re-scan every active skill with the pinned scanners. |
| **`provision.yml`** | manual (`workflow_dispatch`) | `prod` | One-time infra: create the R2 bucket (`r2-bootstrap.mjs`), deploy the CDN Worker, bring up `cdn.simplycubed.com`, smoke-test. `whoami` preflight + cert-propagation retry. |
| **`r2-upload.yml`** | manual | `prod` | Backfill: upload all active skills' blobs + records to R2, then re-hash-verify off the CDN. Idempotent. |
| **`r2-sync.yml`** | push to `main` (+ manual) | `r2-write` | **Auto-upload on merge.** Per skill: skip if already on CDN, else source the unit (R2 or reproduce from upstream) → upload → CDN re-hash verify → **roll back on failure**. Gated on `vars.R2_AUTOUPLOAD == 'true'` (stays *skipped* until enabled). |
| **`r2-verify.yml`** | daily cron + manual | none (public CDN) | Drift monitor: re-hash every blob off the CDN vs the git manifest (no fallback, fails loud) + `snapshot:check` in `SKILLS_FORCE_R2` mode (proves the no-local read path). |
| **`notify-web.yml`** | push to `main` changing `catalog.json` (+ manual) | `WEB_DISPATCH_TOKEN` | Fires a `repository_dispatch` (`simplycubed-catalog-updated`) to `simplycubed/web` so the storefront rebuilds against the new catalog. |

## The lifecycle, end to end

```
add skill PR ──► ci.yml verifies (reproduce from upstream + re-scan)
     │
   merge ──► r2-sync.yml (upload the new blob, verify, roll back on fail)
     │   └─► notify-web.yml (dispatch → web storefront rebuilds)
     │
  daily ──► r2-verify.yml (drift monitor: R2 still serves correct bytes)
```

## Running one manually

```sh
gh workflow run provision.yml --ref main     # one-time infra (approve the prod gate)
gh workflow run r2-upload.yml --ref main     # backfill / re-confirm all blobs
gh workflow run r2-sync.yml   --ref main     # reconcile R2 (idempotent) — a good post-setup smoke test
gh workflow run r2-verify.yml --ref main     # on-demand drift check
```

Watch a run: `gh run watch <id>` or `gh run list --workflow=<file> --limit 1`.

## Recommended follow-ups (see `ESCALATIONS.md`)

- **Demonstrate the drift monitor goes red once** (dispatch against a tampered hex, then revert) — a
  monitor only ever seen green is unproven.
- Wire a **failure notification** on `r2-verify.yml` (a monitor red in the Actions tab that nobody
  opens is a false-clear).
- Rotate the Cloudflare tokens on a schedule; both have expirations.
