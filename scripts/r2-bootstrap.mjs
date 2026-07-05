// r2-bootstrap.mjs — create the R2 bucket as code (idempotent).
//
// Runs in the provisioning Action (with wrangler on PATH + CLOUDFLARE_API_TOKEN /
// CLOUDFLARE_ACCOUNT_ID in env). Creating an existing bucket is treated as success
// so the workflow is safe to re-run.
import { spawnSync } from "node:child_process";

const bucket = process.env.R2_BUCKET || "simplycubed-skills";
const r = spawnSync("wrangler", ["r2", "bucket", "create", bucket], { encoding: "utf8" });
const out = `${r.stdout || ""}${r.stderr || ""}`;

if (r.status === 0) {
  console.log(`✓ created R2 bucket '${bucket}'`);
} else if (/already (exists|owns)|10004|BucketAlreadyOwnedByYou/i.test(out)) {
  console.log(`✓ R2 bucket '${bucket}' already exists`);
} else {
  console.error(`✗ r2 bucket create failed:\n${out}`);
  process.exit(1);
}
