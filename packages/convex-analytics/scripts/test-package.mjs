/**
 * Pack this package, install the tarball with pnpm (under the repo's release-age rule) in a
 * temporary project, and check what a consumer gets under node_modules/@vllnt/convex-analytics/:
 * the required docs and entry points are present, contributor and internal files are absent, and every
 * relative link in llms.txt, README.md and docs/*.md resolves inside the installed package.
 * It imports every `exports` entry with plain Node and type-checks a strict `nodenext`
 * consumer that imports from every entry. Then it runs the documentation contract (check-documentation.mjs) on the installed docs and
 * type-checks every README and docs example against the installed package and the lowest
 * supported `convex`.
 *
 * Run after `pnpm build` (the build copies README, LICENSE, llms.txt and docs/ in).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

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
/**
 * What a consumer imports from each `exports` entry (every key except ./package.json).
 * `values` must exist at runtime and type-check; `types` are only type-checked. An entry
 * without a row fails, so a new export gets a consumer import.
 */
const ENTRY_IMPORTS = {
  ".": { values: ["AnalyticsClient"] },
  "./test": { values: ["default", "register"] },
  "./web": { values: ["webDimensions", "parseUserAgent", "geoFromHeaders", "trackPageview"] },
  "./react": { values: ["useMetric", "useTop", "useTimeseries", "useUniques"] },
  "./convex.config": { values: ["default"] },
  "./convex.config.js": { values: ["default"] },
  "./_generated/component.js": { types: ["ComponentApi"] },
};
/** Entries plain Node cannot import, so they are only type-checked. Any other import failure fails. */
const TYPE_CHECK_ONLY = new Set([
  // Points at TypeScript source (src/test.ts) for convex-test under Vite.
  "./test",
  // @convex-dev/batch-worker 0.3.3 (under @convex-dev/aggregate) imports "./logging" without
  // an extension: Convex's bundler resolves it, plain Node ESM does not.
  "./convex.config",
  "./convex.config.js",
  // Types only: the entry has no runtime file.
  "./_generated/component.js",
]);
/** Run with `node --input-type=module --eval`: argv is the specifier, then the runtime names. */
const RUNTIME_PROBE = `const [specifier, ...names] = process.argv.slice(1);
const module = await import(specifier);
const missing = names.filter((name) => module[name] === undefined);
if (missing.length > 0) throw new Error(\`missing runtime export(s): \${missing.join(", ")}\`);`;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const REPO_BLOB = /^https:\/\/github\.com\/vllnt\/convex-analytics\/blob\/[^/]+\/(.+)$/;

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(join(tmpdir(), "convex-analytics-consumer-"));
const failures = [];

/**
 * The `minimumReleaseAge` and `minimumReleaseAgeExclude` lines of a pnpm-workspace.yaml,
 * re-emitted so the temporary install cannot drift from the repo rule.
 * @param {string} file @returns {string}
 */
function releaseAgeRule(file) {
  const text = readFileSync(file, "utf8");
  const age = /^minimumReleaseAge:[ \t]*(\d+)[ \t]*$/mu.exec(text)?.[1];
  const list = /^minimumReleaseAgeExclude:[ \t]*\n((?:[ \t]+-.*(?:\n|$))+)/mu.exec(text)?.[1];
  if (age === undefined || list === undefined) {
    throw new Error(`${file}: expected minimumReleaseAge and a minimumReleaseAgeExclude list`);
  }
  const excluded = [...list.matchAll(/^[ \t]+-[ \t]*["']?([^"'\s#]+)["']?/gmu)].map((match) => `  - "${match[1]}"`);
  return `minimumReleaseAge: ${age}\nminimumReleaseAgeExclude:\n${excluded.join("\n")}\n`;
}

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

/**
 * Import every entry point with plain Node (except TYPE_CHECK_ONLY) and type-check a strict
 * nodenext consumer that imports from every entry point.
 * @param {string} installed @param {string} consumer @returns {string[]} failures
 */
function checkEntryPoints(installed, consumer) {
  const { name, exports } = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const entries = Object.keys(exports).filter((key) => key !== "./package.json");
  const problems = [...Object.keys(ENTRY_IMPORTS), ...TYPE_CHECK_ONLY]
    .filter((key) => !entries.includes(key))
    .map((key) => `entry point ${key} is listed in test-package.mjs but not in exports`);
  const lines = [];
  entries.forEach((key, index) => {
    const imports = ENTRY_IMPORTS[key];
    if (imports === undefined) {
      problems.push(`entry point ${key} has no ENTRY_IMPORTS row in test-package.mjs`);
      return;
    }
    const specifier = key === "." ? name : `${name}/${key.slice(2)}`;
    const values = imports.values ?? [];
    const alias = (exported) => `${exported} as e${String(index)}_${exported}`;
    if (values.length > 0) lines.push(`export { ${values.map(alias).join(", ")} } from "${specifier}";`);
    if (imports.types) lines.push(`export type { ${imports.types.map(alias).join(", ")} } from "${specifier}";`);
    if (TYPE_CHECK_ONLY.has(key)) return;
    try {
      execFileSync(process.execPath, ["--input-type=module", "--eval", RUNTIME_PROBE, specifier, ...values], {
        cwd: consumer,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const reason = /^\w*Error.*$/mu.exec(String(error.stderr))?.[0] ?? String(error.message);
      problems.push(`entry point ${key}: plain Node import failed: ${reason}`);
    }
  });
  const file = join(consumer, "entry-point-consumer", "index.ts");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${lines.join("\n")}\n`);
  const program = ts.createProgram([file], {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  });
  // skipLibCheck stays off so errors in the installed package's own .d.ts files fail; errors in
  // other packages' declarations are printed as ignored notes, not failures.
  const own = [realpathSync(installed) + sep, realpathSync(file)];
  const ignored = [];
  for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    const where = diagnostic.file && diagnostic.start !== undefined
      ? `${relative(consumer, diagnostic.file.fileName)}:${String(diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1)}`
      : "tsc";
    const path = diagnostic.file && realpathSync(diagnostic.file.fileName);
    if (path && !own.some((prefix) => path.startsWith(prefix))) ignored.push(`${where}: ${message}`);
    else problems.push(`entry-point consumer ${where}: ${message}`);
  }
  if (problems.length === 0) {
    console.log(`OK    entry points: ${String(entries.length - TYPE_CHECK_ONLY.size)} imported with Node, ${String(entries.length)} type-checked (nodenext, strict)`);
  }
  for (const note of ignored) console.log(`NOTE  entry-point consumer: ignored, not in this package: ${note}`);
  return problems;
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
  // No lockfile here, so versions resolve fresh: pnpm applies the repo's release-age rule
  // (npm ignores it). Peers are neither auto-installed nor strict, as with --legacy-peer-deps.
  const workspace = `${releaseAgeRule(join(packageDir, "..", "..", "pnpm-workspace.yaml"))}autoInstallPeers: false\nstrictPeerDependencies: false\n`;
  writeFileSync(join(temporary, "pnpm-workspace.yaml"), workspace);
  console.log(`temporary pnpm-workspace.yaml:\n${workspace}`);
  execFileSync("pnpm", ["add", tarball, ...EXAMPLE_DEPENDENCIES, "--ignore-scripts", "--loglevel=error"], {
    cwd: temporary,
    stdio: "inherit",
  });

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
  failures.push(...checkEntryPoints(installed, temporary));
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
