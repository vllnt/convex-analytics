/**
 * Pack this package, install the tarball in a temporary project, and check what a
 * consumer gets under node_modules/@vllnt/convex-analytics/: the required docs and
 * entry points are present, contributor and internal files are absent, and every
 * relative link in llms.txt, README.md and docs/*.md resolves inside the installed package.
 * Then it runs the documentation contract (check-documentation.mjs) on the installed docs and
 * type-checks every README and docs example against the installed package and the lowest
 * supported `convex`.
 *
 * Run after `pnpm build` (the build copies README, LICENSE, llms.txt and docs/ in).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { checkDocumentation, compileExamples } from "./check-documentation.mjs";

const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/quick-start.md",
  "docs/client-sdk.md",
  "docs/schema.md",
  "docs/api-reference.md",
  "docs/web-preset.md",
  "docs/react.md",
  "docs/multi-product.md",
  "docs/architecture.md",
  "dist/client/index.js",
  "dist/component/convex.config.js",
  "src/client/index.ts",
];
const FORBIDDEN = [
  "AGENTS.md",
  "CLAUDE.md",
  "ROADMAP.md",
  "CONTRIBUTING.md",
  "docs/REBUILD.md",
  "tests",
  "specs",
];
/** Installed next to the tarball so the doc examples compile; convex is the lowest supported peer. */
const EXAMPLE_DEPENDENCIES = [
  "convex@1.45.0",
  "convex-test@0.0.73",
  "vite@8.3.8",
  "vitest@5.1.1",
  "react@19.3.1",
  "@types/react@19.3.0",
];
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const REPO_BLOB = /^https:\/\/github\.com\/vllnt\/convex-analytics\/blob\/[^/]+\/(.+)$/;

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "convex-analytics-consumer-"));
const failures = [];

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

/** @param {string} installed @param {string} file */
function checkLinks(installed, file) {
  const text = readFileSync(join(installed, file), "utf8");
  for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const blob = REPO_BLOB.exec(target);
    if (blob) {
      const path = blob[1].replace(/^packages\/convex-analytics\//, "").replace(/#.*$/, "");
      if (REQUIRED.includes(path)) failures.push(`${file}: link to shipped ${path} must be relative`);
      continue;
    }
    if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
    const resolved = resolve(installed, dirname(file), target.replace(/#.*$/, ""));
    if (!resolved.startsWith(installed + sep) || !existsSync(resolved)) {
      failures.push(`${file}: link ${target} does not resolve inside the package`);
    }
  }
}

try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], {
      cwd: packageDir,
      encoding: "utf8",
    }),
  );
  const tarball = join(temporary, packed[0].filename);
  writeFileSync(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync(
    "npm",
    ["install", tarball, ...EXAMPLE_DEPENDENCIES, "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund", "--loglevel=error"],
    { cwd: temporary, stdio: "inherit" },
  );

  const installed = join(temporary, "node_modules", "@vllnt", "convex-analytics");
  for (const path of REQUIRED) {
    if (!existsSync(join(installed, path))) failures.push(`missing required file: ${path}`);
  }
  for (const path of FORBIDDEN) {
    if (existsSync(join(installed, path))) failures.push(`internal file shipped: ${path}`);
  }
  for (const path of walk(installed)) {
    if (TEST_FILE.test(path)) failures.push(`test file shipped: ${relative(installed, path)}`);
  }
  const docs = existsSync(join(installed, "docs")) ? readdirSync(join(installed, "docs")) : [];
  for (const file of ["llms.txt", "README.md", ...docs.map((name) => `docs/${name}`)]) {
    if (existsSync(join(installed, file))) checkLinks(installed, file);
  }
  const documentation = checkDocumentation(installed, temporary);
  failures.push(...documentation.failures);
  failures.push(...compileExamples(installed, temporary, documentation.examples));
} finally {
  rmSync(temporary, { force: true, recursive: true });
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log(`OK    package contents: ${REQUIRED.length} required files, links resolve`);
console.log("OK    documentation contract and examples type-check");
