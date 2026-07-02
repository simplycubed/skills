// fetch.mjs <slug>
//
// Fetches the upstream skill at its pinned commit SHA and assembles the exact
// "published unit" — the bytes an agent installs — into .scan-work/<slug>/unit.
//
// Why assembly (not just extraction): skills that live in a repo SUBDIRECTORY
// frequently carry no LICENSE of their own; the repo-root LICENSE covers them.
// Publishing only the subdir would ship unlicensed bytes, so we copy the
// repo-root LICENSE into the unit — which is exactly what permissive
// redistribution (e.g. MIT) requires: the copyright/permission notice must
// travel with copies. We then confirm the LICENSE text matches the declared
// SPDX id and fail closed on a mismatch, so a config can't mislabel a license.
import { readFileSync, existsSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import yaml from "js-yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "config/skills");
const WORK = join(ROOT, ".scan-work");

const LICENSE_NAMES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "COPYING", "COPYING.md"];

// Minimal SPDX text detectors — enough to confirm the declared license matches
// the bytes we're about to publish. Not a full license classifier.
const LICENSE_SIGNATURES = {
  "MIT": /\bMIT License\b|Permission is hereby granted, free of charge/i,
  "Apache-2.0": /Apache License,?\s+Version 2\.0/i,
  "BSD-3-Clause": /Redistribution and use[\s\S]*Neither the name/i,
  "BSD-2-Clause": /Redistribution and use in source and binary forms/i,
  "ISC": /ISC License|Permission to use, copy, modify, and\/or distribute/i,
  "0BSD": /Permission to use, copy, modify, and\/or distribute this software/i,
  "Unlicense": /free and unencumbered software released into the public domain/i,
  "Zlib": /zlib License|altered source versions must be plainly marked/i,
};

export function loadConfig(slug, dir = SKILLS_DIR) {
  const p = join(dir, `${slug}.yaml`);
  if (!existsSync(p)) throw new Error(`no config for slug '${slug}' at ${p}`);
  return yaml.load(readFileSync(p, "utf8"));
}

function findLicense(dir) {
  return LICENSE_NAMES.map((n) => join(dir, n)).find(existsSync) || null;
}

// License verdict for an already-assembled unit dir (used when re-verifying a
// committed snapshot, where there is no fetch to run).
export function licenseVerdict(unitDir, declaredLicense) {
  const lic = findLicense(unitDir);
  if (!lic) return { licensePresent: false, licenseMatches: null };
  const sig = LICENSE_SIGNATURES[declaredLicense];
  return { licensePresent: true, licenseMatches: sig ? sig.test(readFileSync(lic, "utf8")) : null };
}

// Download + extract the repo at the exact SHA. Returns the extracted src dir.
function fetchSrc(repo, sha, dest) {
  mkdirSync(dest, { recursive: true });
  const tarball = join(dest, "repo.tar.gz");
  const url = `https://codeload.github.com/${repo}/tar.gz/${sha}`;
  const dl = spawnSync("curl", ["-sSLf", url, "-o", tarball], { encoding: "utf8" });
  if (dl.status !== 0) throw new Error(`fetch failed for ${repo}@${sha}: ${dl.stderr || dl.status}`);
  const src = join(dest, "src");
  mkdirSync(src, { recursive: true });
  const ex = spawnSync("tar", ["-xzf", tarball, "-C", src, "--strip-components=1"], { encoding: "utf8" });
  if (ex.status !== 0) throw new Error(`extract failed: ${ex.stderr || ex.status}`);
  return src;
}

// Assemble the published unit from an ALREADY-EXTRACTED source tree. Pure of the
// network, so it is unit-testable: given a src dir + config, it produces the exact
// bytes we publish and the license verdict. `dest` is where the unit is written.
export function assembleFromSrc(cfg, src, dest) {
  const { slug } = cfg;
  const { repo, sha, path: subpath } = cfg.upstream;
  const unitSrc = subpath ? join(src, subpath) : src;
  if (!existsSync(unitSrc)) throw new Error(`path '${subpath}' not found in ${repo}@${sha}`);
  const unit = join(dest, "unit");
  rmSync(unit, { recursive: true, force: true });
  cpSync(unitSrc, unit, { recursive: true });

  // Ensure a LICENSE travels with the published unit.
  let licenseSource = "unit";
  let unitLicense = findLicense(unit);
  if (!unitLicense) {
    const rootLicense = findLicense(src);
    if (rootLicense) {
      const target = join(unit, "LICENSE");
      cpSync(rootLicense, target);
      unitLicense = target;
      licenseSource = "repo-root";
    } else {
      licenseSource = "none";
    }
  }

  // Confirm the effective license text matches the declared SPDX id.
  let licenseMatches = null;
  if (unitLicense) {
    const text = readFileSync(unitLicense, "utf8");
    const sig = LICENSE_SIGNATURES[cfg.license];
    licenseMatches = sig ? sig.test(text) : null; // null = no detector for this id
  }

  return {
    slug,
    repo,
    sha,
    path: subpath || null,
    unitDir: unit,
    srcDir: src,
    licensePresent: !!unitLicense,
    licenseSource,
    declaredLicense: cfg.license,
    licenseMatches,
  };
}

export function assembleUnit(cfg, { work = WORK } = {}) {
  const dest = join(work, cfg.slug);
  rmSync(dest, { recursive: true, force: true });
  const src = fetchSrc(cfg.upstream.repo, cfg.upstream.sha, dest);
  return assembleFromSrc(cfg, src, dest);
}

function main() {
  const slug = process.argv[2];
  if (!slug) { console.error("usage: node scripts/fetch.mjs <slug>"); process.exit(2); }
  const r = assembleUnit(loadConfig(slug));
  console.log(JSON.stringify(r, null, 2));
  if (!r.licensePresent) { console.error("✗ no LICENSE in published unit or repo root"); process.exit(1); }
  if (r.licenseMatches === false) { console.error(`✗ LICENSE text does not match declared '${r.declaredLicense}'`); process.exit(1); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
