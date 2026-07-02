// Validates every config/skills/*.yaml against config/skill.schema.json and
// checks that each file's `slug` matches its filename. Fails (exit 1) on any
// error. Run in CI as part of the certification gate, and locally via
// `pnpm validate`.
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import Ajv from "ajv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(
  readFileSync(join(root, "config/skill.schema.json"), "utf8")
);
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

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

  if (!validate(parsed)) {
    ok = false;
    console.error(`✗ Invalid skill config: ${file}`);
    console.error(JSON.stringify(validate.errors, null, 2));
    continue;
  }
  if (parsed.slug !== slug) {
    ok = false;
    console.error(`✗ slug "${parsed.slug}" must match filename "${slug}" (${file})`);
  }
}

if (!ok) process.exit(1);
console.log(`✓ ${files.length} skill config(s) valid`);
