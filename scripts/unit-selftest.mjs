// unit-selftest.mjs
//
// Hermetic (no-network) unit tests for the certification internals that the
// live-fetch self-tests can't exercise: license assembly + SPDX matching
// (fetch.mjs), fail-closed-on-missing-scanner (scan.mjs), config rejection
// (validate-skills.mjs), and the structure guards (certify.mjs). Synthesizes
// throwaway trees in a temp dir; asserts with node:assert.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assembleFromSrc } from "./fetch.mjs";
import { scanUnit } from "./scan.mjs";
import { validateConfig } from "./validate-skills.mjs";
import { certify } from "./certify.mjs";

const MIT = "MIT License\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\n";
const APACHE = "Apache License\nVersion 2.0, January 2004\nhttp://www.apache.org/licenses/\n";
const SHA = "0".repeat(40);
const tmp = mkdtempSync(join(tmpdir(), "unit-selftest-"));
let n = 0;
const scratch = () => { const d = join(tmp, `t${n++}`); mkdirSync(d, { recursive: true }); return d; };

console.log("— 1a: assembleFromSrc (license assembly + SPDX match) —");
{
  // repo-root LICENSE + a subdir skill with none of its own
  const src = scratch();
  writeFileSync(join(src, "LICENSE"), MIT);
  mkdirSync(join(src, "skills/foo"), { recursive: true });
  writeFileSync(join(src, "skills/foo/SKILL.md"), "---\nname: foo\ndescription: x\n---\n");
  const cfg = { slug: "foo", license: "MIT", upstream: { repo: "a/b", sha: SHA, path: "skills/foo" } };
  const r = assembleFromSrc(cfg, src, scratch());
  assert.equal(r.licenseSource, "repo-root", "root LICENSE copied into subdir unit");
  assert.equal(r.licensePresent, true);
  assert.equal(r.licenseMatches, true, "MIT text matches declared MIT");
}
{
  // declared MIT but the LICENSE text is Apache => must be flagged as a mismatch
  const src = scratch();
  writeFileSync(join(src, "LICENSE"), APACHE);
  writeFileSync(join(src, "SKILL.md"), "---\nname: x\ndescription: y\n---\n");
  const cfg = { slug: "x", license: "MIT", upstream: { repo: "a/b", sha: SHA } };
  const r = assembleFromSrc(cfg, src, scratch());
  assert.equal(r.licenseMatches, false, "Apache text must NOT match declared MIT (fail-closed on mislabel)");
}
{
  // a path that doesn't exist must throw
  const src = scratch();
  writeFileSync(join(src, "LICENSE"), MIT);
  const cfg = { slug: "z", license: "MIT", upstream: { repo: "a/b", sha: SHA, path: "skills/missing" } };
  assert.throws(() => assembleFromSrc(cfg, src, scratch()), /not found/, "missing path throws");
}
console.log("  ✓ 1a passed");

console.log("— 1c: scanUnit fails closed when a required scanner is missing —");
{
  const src = scratch();
  writeFileSync(join(src, "LICENSE"), MIT);
  writeFileSync(join(src, "SKILL.md"), "---\nname: q\ndescription: benign\n---\nSummarize text.\n");
  const cfg = { slug: "q", license: "MIT", upstream: { repo: "a/b", sha: SHA } };
  const assembled = assembleFromSrc(cfg, src, scratch());
  // Force both scanners unresolvable: no PATH, no env overrides.
  const savedPath = process.env.PATH, savedGl = process.env.GITLEAKS_BIN, savedOsv = process.env.OSV_BIN;
  process.env.PATH = "/nonexistent-xyz";
  delete process.env.GITLEAKS_BIN; delete process.env.OSV_BIN;
  let rec;
  try { rec = scanUnit("q", assembled); }
  finally { process.env.PATH = savedPath; if (savedGl) process.env.GITLEAKS_BIN = savedGl; if (savedOsv) process.env.OSV_BIN = savedOsv; }
  assert.equal(rec.passed, false, "missing required scanner => passed:false");
  assert.ok(rec.scan_errors.length >= 2, "both missing scanners recorded as errors");

  // With --allow-missing-scanners: skipped, marked incomplete, NOT an error.
  const savedPath2 = process.env.PATH;
  process.env.PATH = "/nonexistent-xyz";
  delete process.env.GITLEAKS_BIN; delete process.env.OSV_BIN;
  let rec2;
  try { rec2 = scanUnit("q", assembled, { allowMissing: true }); }
  finally { process.env.PATH = savedPath2; }
  assert.equal(rec2.incomplete, true, "allowMissing => record marked incomplete");
  assert.equal(rec2.scan_errors.length, 0, "allowMissing => skipped scanners are not errors");
  assert.equal(rec2.tools.gitleaks, "skipped");
  assert.equal(rec2.tools["osv-scanner"], "skipped");
}
console.log("  ✓ 1c passed");

console.log("— 1d: validateConfig rejects bad configs —");
{
  // No `version` field: the listing version is derived from upstream, not authored
  // here (the input schema forbids unknown keys, so a stray version would be rejected).
  const good = { slug: "ok", name: "Ok", description: "d", status: "active",
    upstream: { repo: "a/b", sha: SHA }, author: { name: "A" }, license: "MIT" };
  assert.equal(validateConfig(good, "ok").ok, true, "valid config passes");
  assert.equal(validateConfig({ ...good, version: "1.0.0" }, "ok").ok, false, "author-set version is rejected (derived from upstream)");
  assert.equal(validateConfig({ ...good, license: "GPL-3.0" }, "ok").ok, false, "copyleft license rejected");
  assert.equal(validateConfig({ ...good, slug: "Bad_Slug" }, "Bad_Slug").ok, false, "bad slug pattern rejected");
  const { name, ...missingName } = good;
  assert.equal(validateConfig(missingName, "ok").ok, false, "missing required field rejected");
  assert.equal(validateConfig(good, "different-file").ok, false, "slug != filename rejected");
}
console.log("  ✓ 1d passed");

console.log("— 1e: certify structure guards each fire —");
{
  const d = scratch();
  writeFileSync(join(d, "LICENSE"), MIT);
  writeFileSync(join(d, ".gitmodules"), "[submodule]\n");
  writeFileSync(join(d, "big.bin"), Buffer.alloc(2 * 1024 * 1024 + 16)); // > 2 MB
  writeFileSync(join(d, "asset.png"), "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 1\n"); // LFS pointer
  symlinkSync("/etc/hosts", join(d, "escape")); // symlink escaping the unit root
  const v = certify(d);
  const s = v.checks.structure.join(" | ");
  assert.match(s, /submodule/, "submodule flagged");
  assert.match(s, /oversized/, "oversized file flagged");
  assert.match(s, /LFS/, "LFS pointer flagged");
  assert.match(s, /symlink escapes/, "escaping symlink flagged");
}
console.log("  ✓ 1e passed");

console.log("— 1f: assembleFromSrc dereferences in-repo symlinks, rejects escaping ones —");
{
  // benign: a skill subdir shares a repo-level folder via a relative symlink
  const src = scratch();
  writeFileSync(join(src, "LICENSE"), MIT);
  mkdirSync(join(src, "shared"), { recursive: true });
  writeFileSync(join(src, "shared/note.md"), "shared content");
  mkdirSync(join(src, "skill"), { recursive: true });
  writeFileSync(join(src, "skill/SKILL.md"), "---\nname: s\ndescription: d\n---\n");
  symlinkSync("../shared", join(src, "skill/refs")); // relative, resolves inside the repo
  const r = assembleFromSrc({ slug: "s", license: "MIT", upstream: { repo: "a/b", sha: SHA, path: "skill" } }, src, scratch());
  assert.equal(r.symlinkFindings.length, 0, "benign in-repo symlink accepted");
  assert.equal(existsSync(join(r.unitDir, "refs/note.md")), true, "symlink target inlined into the unit");
  assert.equal(lstatSync(join(r.unitDir, "refs")).isSymbolicLink(), false, "published unit is symlink-free");
}
{
  // malicious: a symlink escaping the repo must be flagged and NOT copied
  const src = scratch();
  writeFileSync(join(src, "LICENSE"), MIT);
  mkdirSync(join(src, "skill"), { recursive: true });
  writeFileSync(join(src, "skill/SKILL.md"), "---\nname: e\ndescription: d\n---\n");
  symlinkSync("/etc/hosts", join(src, "skill/evil")); // absolute path, escapes the repo
  const r = assembleFromSrc({ slug: "e", license: "MIT", upstream: { repo: "a/b", sha: SHA, path: "skill" } }, src, scratch());
  assert.ok(r.symlinkFindings.length >= 1, "escaping symlink flagged");
  assert.equal(existsSync(join(r.unitDir, "evil")), false, "escaping symlink NOT copied into the unit");
}
console.log("  ✓ 1f passed");

rmSync(tmp, { recursive: true, force: true });
console.log("✓ unit self-test passed (assembly/license, fail-closed scanner, validator, structure guards, symlinks)");
