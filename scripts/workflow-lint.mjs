// workflow-lint.mjs — parse every .github/workflows/*.yml with a real YAML parser
// and fail on any error. Catches the "This run likely failed because of a workflow
// file issue" class locally (e.g. an unquoted `name:` whose value contains `: `,
// which YAML reads as a nested mapping) BEFORE a push wastes a CI round-trip.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const dir = ".github/workflows";
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".yml") || x.endsWith(".yaml"))) {
  try {
    yaml.load(readFileSync(join(dir, f), "utf8"));
    console.log(`✓ ${f}`);
  } catch (e) {
    bad++;
    console.log(`✗ ${f}: ${e.message.split("\n")[0]}`);
  }
}
if (bad) { console.error(`✗ workflow-lint FAILED (${bad} invalid)`); process.exit(1); }
console.log("✓ all workflow YAML valid");
