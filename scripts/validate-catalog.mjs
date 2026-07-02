// validate-catalog.mjs
//
// Validates the generated catalog.json against its published contract
// (config/catalog.schema.json). This is the guard on the interface the
// storefront consumes: if generate.mjs ever emits a shape the schema doesn't
// allow, CI fails here instead of the storefront breaking silently at runtime.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(ROOT, "config/catalog.schema.json"), "utf8"));
const catalog = JSON.parse(readFileSync(join(ROOT, "catalog.json"), "utf8"));

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);

if (!validate(catalog)) {
  console.error("✗ catalog.json does not match config/catalog.schema.json:");
  for (const e of validate.errors) console.error(`  ${e.instancePath || "/"} ${e.message}`);
  process.exit(1);
}
console.log(`✓ catalog.json valid against contract (schemaVersion ${catalog.schemaVersion}, ${catalog.skills.length} skill(s))`);
