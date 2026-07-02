// Validates every config/skills/*.yaml against config/skill.schema.json and
// checks that each file's `slug` matches its filename. Fails (exit 1) on any
// error. Run in CI as part of the certification gate, and locally via
// `pnpm validate`.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import Ajv from "ajv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(
  readFileSync(join(root, "config/skill.schema.json"), "utf8")
);
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

// Validate one parsed config against the schema + the slug==filename rule.
// Returns { ok, errors } so callers (CLI and tests) can assert on rejection.
export function validateConfig(parsed, slug) {
  const errors = [];
  if (!validate(parsed)) {
    for (const e of validate.errors) errors.push(`${e.instancePath || "/"} ${e.message}`);
  }
  if (slug !== undefined && parsed && parsed.slug !== slug) {
    errors.push(`slug "${parsed?.slug}" must match filename "${slug}"`);
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const dir = join(root, "config/skills");
  const files = readdirSync(dir).filter((f) => f.endsWith(".yaml"));
  if (files.length === 0) {
    console.error("✗ No skill YAML files found in config/skills");
    process.exit(1);
  }

  let ok = true;
  for (const file of files) {
    const slug = file.replace(/\.yaml$/, "");
    const parsed = yaml.load(readFileSync(join(dir, file), "utf8"));
    const { ok: valid, errors } = validateConfig(parsed, slug);
    if (!valid) {
      ok = false;
      console.error(`✗ Invalid skill config: ${file}`);
      for (const e of errors) console.error(`  ${e}`);
    }
  }

  if (!ok) process.exit(1);
  console.log(`✓ ${files.length} skill config(s) valid`);
}

// Guard the CLI so importing validateConfig (e.g. from a test) doesn't scan config/skills.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
