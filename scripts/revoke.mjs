// revoke.mjs <slug> [--write]
//
// Pull a listed skill after a later safety failure (a newly disclosed vuln, a
// leaked secret, an author takedown): flip its config status to `revoked` and
// remove its content-addressed snapshot. Because only status:active skills are
// generated into the manifests, a revoked skill drops out of both catalog.json
// and marketplace.json on the next `pnpm generate`; and with its snapshot gone
// we stop serving its bytes — fulfilling the README's revocation promise.
//
// Without --write this is a dry run. After --write, run `pnpm generate` to
// refresh the manifests (CI's no-drift gate enforces it).
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "config/skills");
const SNAP_DIR = join(ROOT, "snapshots");

export function revoke(slug, { write = false, skillsDir = SKILLS_DIR, snapDir = SNAP_DIR } = {}) {
  const cfgPath = join(skillsDir, `${slug}.yaml`);
  if (!existsSync(cfgPath)) throw new Error(`no config for slug '${slug}'`);
  const before = readFileSync(cfgPath, "utf8");
  // Targeted replace of the status line — preserves the rest of the YAML verbatim.
  const after = before.replace(/^(status:\s*).*$/m, "$1revoked");
  if (after === before && !/^status:\s*revoked\s*$/m.test(before)) {
    throw new Error(`could not find a 'status:' line to revoke in ${slug}.yaml`);
  }
  const snapshotPath = join(snapDir, slug);
  const hadSnapshot = existsSync(snapshotPath);
  if (write) {
    writeFileSync(cfgPath, after);
    if (hadSnapshot) rmSync(snapshotPath, { recursive: true, force: true });
  }
  return { slug, statusSetTo: "revoked", snapshotRemoved: hadSnapshot };
}

function main() {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const slug = args.find((a) => !a.startsWith("--"));
  if (!slug) { console.error("usage: node scripts/revoke.mjs <slug> [--write]"); process.exit(2); }
  const r = revoke(slug, { write });
  console.error(`${write ? "revoked" : "would revoke"} ${slug}: status -> revoked${r.snapshotRemoved ? ", snapshot removed" : ""}`);
  if (write) console.error("next: run `pnpm generate` to drop it from the manifests");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
