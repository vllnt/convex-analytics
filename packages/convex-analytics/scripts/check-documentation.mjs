/**
 * Agent-first documentation contract, checked on the installed tarball (what consumers get).
 * Adapted from the @vllnt/convex-buckets reference. Run by test-package.mjs:
 *
 *   const examples = checkDocumentation(installed, consumer); // static checks
 *   compileExamples(installed, consumer, examples);           // tsc on README + docs examples
 *
 * Both return a list of failure messages; an empty list means the docs pass.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import ts from "typescript";

/** README `##` sections, in this order. */
export const SECTIONS = [
  "For coding agents",
  "When to use",
  "Install",
  "Quick start",
  "API",
  "Common tasks",
  "Errors and fixes",
  "Limits and gotchas",
  "Compatibility",
  "Testing",
  "Security",
  "Related packages",
  "Contributing",
  "Links",
  "License",
];
const FIRST_LINES = 40;
const OSS = "https://oss.vllnt.com";
const PATH_COMMENT = /^\/\/ (\S+\.tsx?)\n/u;
const SIGNATURE = /^\/\/ signature\n/u;
const COMPILED = new Set(["ts", "tsx"]);
/** The retired vllnt domain, built from parts so this file does not contain it. */
const RETIRED_DOMAIN = new RegExp(["vllnt", "ai"].join(String.raw`\.`), "iu");

/** @param {string} name package name without the scope */
export const footer = (name) =>
  `---\n\nPart of [vllnt open source](${OSS}) · [Package page](${OSS}/packages/${name}) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)\n`;

/** @param {string} name package name without the scope */
export const ecosystem = (name) =>
  [
    "## Ecosystem\n",
    `- [Package page](${OSS}/packages/${name})`,
    `- [Release feed](${OSS}/packages/${name}/rss.xml)`,
    `- [All @vllnt packages](${OSS}/llms.txt)`,
    "- [Search vllnt packages and docs](https://index.vllnt.com)",
    "- [vllnt](https://vllnt.com/llms.txt)",
    "- [Author](https://bntvllnt.com)\n",
  ].join("\n");

/** Body of the README `## Links` section. @param {string} name @param {string} repository */
export const links = (name, repository) =>
  [
    `- Docs and changelog: [oss.vllnt.com/packages/${name}](${OSS}/packages/${name}) · [release feed](${OSS}/packages/${name}/rss.xml)`,
    `- All @vllnt packages: [oss.vllnt.com](${OSS}) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)`,
    `- Source and issues: [GitHub](${repository}) · [issues](${repository}/issues) · [npm](https://www.npmjs.com/package/@vllnt/${name})`,
    "- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)",
    "- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)",
    "- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)",
  ].join("\n");

/** GitHub heading anchor. @param {string} heading */
export const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, "")
    .replaceAll(/\s/gu, "-");

/**
 * Fenced code blocks with 1-based start lines.
 * @param {string} text
 * @returns {{ blocks: { code: string, lang: string, line: number }[], unclosed: boolean }}
 */
export function codeBlocks(text) {
  /** @type {{ code: string, lang: string, line: number }[]} */
  const blocks = [];
  /** @type {{ lang: string, line: number, lines: string[] } | undefined} */
  let open;
  text.split("\n").forEach((line, index) => {
    if (!line.startsWith("```")) {
      open?.lines.push(line);
      return;
    }
    if (open === undefined) {
      open = { lang: line.slice(3).trim(), line: index + 1, lines: [] };
      return;
    }
    blocks.push({ code: open.lines.join("\n"), lang: open.lang, line: open.line });
    open = undefined;
  });
  return { blocks, unclosed: open !== undefined };
}

/** Lines outside code blocks, 1-based. @param {string} text */
function linesOutsideCode(text) {
  const inCode = new Set(
    codeBlocks(text).blocks.flatMap(({ code, line }) =>
      Array.from({ length: code.split("\n").length + 2 }, (_, offset) => line + offset),
    ),
  );
  return text
    .split("\n")
    .map((content, index) => ({ content, line: index + 1 }))
    .filter(({ line }) => !inCode.has(line));
}

/** Heading anchors, skipping `#` lines in code blocks. @param {string} text */
function anchors(text) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  const headings = linesOutsideCode(text).flatMap(
    ({ content }) => /^#{1,6}\s+(.+)$/u.exec(content)?.slice(1) ?? [],
  );
  return new Set(
    headings.map((heading) => {
      const base = slug(heading);
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base}-${String(count)}`;
    }),
  );
}

/** `##` sections outside code blocks. @param {string} text */
function sections(text) {
  const lines = text.split("\n");
  const heads = linesOutsideCode(text).filter(({ content }) => content.startsWith("## "));
  return heads.map((head, index) => ({
    body: lines.slice(head.line, (heads[index + 1]?.line ?? lines.length + 1) - 1).join("\n"),
    line: head.line,
    name: head.content.slice(3).trim(),
  }));
}

/** Files under a directory, skipping nested node_modules. @param {string} directory @returns {string[]} */
function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

/** Shipped docs keyed by package-relative path. @param {string} installed */
function readTexts(installed) {
  const docs = readdirSync(join(installed, "docs"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => `docs/${file}`);
  return Object.fromEntries(
    ["README.md", "llms.txt", ...docs].map((file) => [file, readFileSync(join(installed, file), "utf8")]),
  );
}

/**
 * Static documentation checks. Returns the failures and the examples to compile.
 * @param {string} installed package directory inside node_modules
 * @param {string} consumer project that has the package installed
 */
export function checkDocumentation(installed, consumer) {
  /** @type {string[]} */
  const failures = [];
  /** @param {boolean} ok @param {string} message */
  const expect = (ok, message) => {
    if (!ok) failures.push(message);
  };
  const metadata = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const name = metadata.name.split("/").at(-1);
  const texts = readTexts(installed);
  const readme = texts["README.md"];
  const parts = sections(readme);
  /** @param {string} title */
  const section = (title) => parts.find((part) => part.name === title)?.body ?? "";

  // Package metadata: one searchable sentence, 8-12 keywords, the shared link fields.
  const description = String(metadata.description ?? "");
  expect(description.length > 0 && description.length <= 160, "package.json description: 1 to 160 characters");
  expect(!/vllnt/iu.test(description), "package.json description must not mention vllnt");
  const keywords = Array.isArray(metadata.keywords) ? metadata.keywords : [];
  expect(new Set(keywords).size === keywords.length, "package.json keywords repeat");
  expect(keywords.length >= 8 && keywords.length <= 12, "package.json: 8 to 12 keywords");
  expect(metadata.homepage === `${OSS}/packages/${name}`, `package.json homepage must be ${OSS}/packages/${name}`);
  expect(typeof metadata.bugs?.url === "string", "package.json needs bugs.url");
  expect(typeof metadata.funding?.url === "string", "package.json needs funding.url");
  expect(metadata.author?.url === "https://bntvllnt.com", "package.json author.url must be https://bntvllnt.com");
  expect(typeof metadata.license === "string", "package.json needs license");
  const source = String(metadata.repository?.url ?? "");
  expect(source.length > 0, "package.json needs repository.url");
  const repository = source.replace(/^git\+/u, "").replace(/\.git$/u, "");

  // Title, one sentence equal to the description, fixed sections in order, none empty.
  expect(readme.startsWith(`# ${metadata.name}\n\n`), "README must start with # <package name> and a blank line");
  const intro = readme.split("\n\n")[1]?.replaceAll(/\s*\n\s*/gu, " ") ?? "";
  expect(intro === description, "README line under the title must equal the package.json description");
  const names = parts.map((part) => part.name);
  expect(
    JSON.stringify(names) === JSON.stringify(SECTIONS),
    `README ## sections must be, in order: ${SECTIONS.join(" · ")}\n      found: ${names.join(" · ")}`,
  );
  parts.forEach((part) => {
    expect(part.body.trim().length > 0, `README section ${part.name} is empty; say in one line why it does not apply`);
  });
  expect(section("For coding agents").trim().split("\n").length <= 3, "README For coding agents: 3 lines at most");

  // When to use: 2-4 "Use it when", then 1-3 "Do not use it when" naming the better choice.
  const bullets = section("When to use")
    .replaceAll(/\n {2,}/gu, " ")
    .split("\n")
    .filter((line) => line.startsWith("- "));
  const use = bullets.filter((line) => line.startsWith("- Use it when "));
  const avoid = bullets.filter((line) => line.startsWith("- Do not use it when "));
  expect(use.length >= 2 && use.length <= 4, "When to use: 2 to 4 '- Use it when' bullets");
  expect(avoid.length >= 1 && avoid.length <= 3, "When to use: 1 to 3 '- Do not use it when' bullets");
  expect(JSON.stringify(bullets) === JSON.stringify([...use, ...avoid]), "When to use: 'Use it when' bullets first, nothing else");
  avoid.forEach((line) => expect(/`[^`]+`/u.test(line), `'Do not use it when' must name the better choice: ${line}`));

  // Install command and first example near the top; badges below Quick start.
  const lines = readme.split("\n");
  const escaped = metadata.name.replaceAll(/[$()*+./?[\\\]^{|}]/gu, String.raw`\$&`);
  const install = lines.findIndex((line) => new RegExp(String.raw`\b(?:add|install)\s+${escaped}\b`, "u").test(line));
  expect(install !== -1 && install < FIRST_LINES, `README install command must be within the first ${String(FIRST_LINES)} lines`);
  const quick = parts.find((part) => part.name === "Quick start")?.line ?? Infinity;
  const example = codeBlocks(readme).blocks.find((block) => block.line > quick);
  expect(example !== undefined && example.line <= FIRST_LINES, `README first Quick start example must start within the first ${String(FIRST_LINES)} lines`);
  lines.forEach((line, index) => {
    if (/img\.shields\.io|badge\.svg/u.test(line)) expect(index + 1 > quick, `README:${String(index + 1)} badges go below Quick start`);
  });

  // Identity blocks: Links section and footer exactly; llms.txt summary, links, Ecosystem.
  expect(section("Links").trim() === links(name, repository), "README ## Links must be exactly the shared Links block");
  expect(readme.endsWith(footer(name)), "README must end with the shared vllnt footer");
  const llms = texts["llms.txt"];
  expect(llms.split("\n").includes(`> ${description}`), "llms.txt needs '> <package.json description>'");
  expect(llms.includes("\n## When to use\n"), "llms.txt needs ## When to use");
  expect(llms.includes("](./README.md#api)"), "llms.txt must link the API table ./README.md#api");
  expect(llms.includes("](./README.md#errors-and-fixes)"), "llms.txt must link ./README.md#errors-and-fixes");
  expect(llms.endsWith(ecosystem(name)), "llms.txt must end with the shared ## Ecosystem block");
  expect(llms.split(`${OSS}/llms.txt`).length - 1 === 1, "llms.txt must link the package index once");
  const peer = metadata.peerDependencies?.convex;
  expect(llms.includes(`convex@${String(peer)}`), `llms.txt must name convex@${String(peer)} (peerDependencies.convex)`);

  // Every block has a language; ts/tsx blocks are complete files or marked signatures.
  /** @type {{ code: string, path: string, file: string, line: number }[]} */
  const examples = [];
  Object.entries(texts).forEach(([file, text]) => {
    const { blocks, unclosed } = codeBlocks(text);
    expect(!unclosed, `${file} has an unclosed code block`);
    blocks.forEach((block) => {
      const where = `${file}:${String(block.line)}`;
      expect(block.lang.length > 0, `${where} code block has no language tag`);
      if (!COMPILED.has(block.lang)) return;
      if (file !== "README.md" && SIGNATURE.test(block.code)) return;
      expect(!/^\s*(?:\/\/\s*)?(?:\.\.\.|…)\s*$/mu.test(block.code), `${where} has a ... gap`);
      const path = PATH_COMMENT.exec(block.code)?.[1];
      expect(path !== undefined, `${where} must start with a // <path>.ts(x) comment${file === "README.md" ? "" : " or // signature"}`);
      if (path !== undefined) examples.push({ code: block.code, path, file, line: block.line });
    });
  });

  // Links: relative targets and anchors resolve; external URLs parse; descriptive text; alt text.
  Object.entries(texts).forEach(([file, text]) => {
    const outside = linesOutsideCode(text).map(({ content }) => content).join("\n");
    for (const match of outside.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/gu)) {
      const [, image, label = "", target = ""] = match;
      if (image) expect(label.trim().length > 0, `${file}: image ${target} needs alt text`);
      expect(!/^(?:here|click here|this|link)$/iu.test(label.trim()), `${file}: link text "${label}" must describe its target`);
      if (/^[a-z][a-z+.-]*:/iu.test(target)) {
        let ok = false;
        try {
          ok = ["https:", "http:", "mailto:"].includes(new URL(target).protocol);
        } catch {
          ok = false;
        }
        expect(ok, `${file}: malformed external link ${target}`);
        continue;
      }
      const [path = "", anchor] = target.split("#");
      const resolved = path ? join(dirname(join(installed, file)), path) : join(installed, file);
      if (!existsSync(resolved)) {
        failures.push(`${file}: link ${target} does not resolve`);
        continue;
      }
      if (anchor !== undefined) {
        expect(anchors(readFileSync(resolved, "utf8")).has(anchor), `${file}: link ${target} has no such anchor`);
      }
    }
  });

  // @vllnt packages named as alternatives link their package page; no retired domain anywhere.
  for (const title of ["When to use", "Related packages"]) {
    for (const [, other, url] of section(title).matchAll(/\[`?@vllnt\/([\w-]+)`?\]\(([^)]+)\)/gu)) {
      expect(url === `${OSS}/packages/${String(other)}`, `README ${title}: link @vllnt/${String(other)} to ${OSS}/packages/${String(other)}`);
    }
  }
  filesUnder(installed).forEach((file) => {
    expect(!RETIRED_DOMAIN.test(readFileSync(file, "utf8")), `${relative(installed, file)} mentions the retired vllnt domain; use vllnt.com`);
  });

  // Every public export: TSDoc summary, README API row, heading in docs/; main entry has @see.
  const table = section("API")
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .join("\n");
  const headings = new Set(
    Object.entries(texts)
      .filter(([file]) => file.startsWith("docs/"))
      .flatMap(([, text]) => [...anchors(text)]),
  );
  checkExports(consumer, metadata, table, headings, expect);

  // Every error code and thrown message in src is in the Errors and fixes table.
  const errors = section("Errors and fixes");
  const component = filesUnder(join(installed, "src")).filter(
    (file) => /\.tsx?$/u.test(file) && !file.includes("_generated"),
  );
  const sourceText = component.map((file) => readFileSync(file, "utf8")).join("\n");
  const codes = new Set([...sourceText.matchAll(/invalidInput\(\s*"([A-Z][A-Z\d_]+)"/gu)].map((m) => String(m[1])));
  expect(codes.size > 0, "found no error codes in src; update the pattern in check-documentation.mjs");
  codes.forEach((code) => expect(errors.includes(`\`${code}\``), `Errors and fixes lacks the code ${code}`));
  const messages = new Set([
    ...[...sourceText.matchAll(/throw new Error\(\s*"([^"]+)"/gu)].map((m) => String(m[1])),
    ...[...sourceText.matchAll(/\berror\(\s*"([^"]+)"/gu)].map((m) => String(m[1])),
  ]);
  expect(messages.size > 0, "found no thrown messages in src; update the pattern in check-documentation.mjs");
  messages.forEach((message) => expect(errors.includes(`\`${message}\``), `Errors and fixes lacks the message "${message}"`));

  // Every hard cap in the component (.take(N), Math.min(x, N)) is in Limits and gotchas.
  const limits = section("Limits and gotchas").replaceAll(/(\d),(?=\d{3}\b)/gu, "$1");
  const caps = new Set([
    ...[...sourceText.matchAll(/\.take\(\s*(\d+)\s*\)/gu)].map((m) => String(m[1])),
    ...[...sourceText.matchAll(/Math\.min\([^,()]+,\s*(\d+)\s*\)/gu)].map((m) => String(m[1])),
    ...[...sourceText.matchAll(/const [A-Z_]*(?:CAP|BATCH)\s*=\s*(\d+)/gu)].map((m) => String(m[1])),
  ]);
  caps.forEach((cap) => expect(new RegExp(String.raw`\b${cap}\b`, "u").test(limits), `Limits and gotchas does not mention the cap ${cap}`));

  return { examples, failures };
}

/**
 * @param {string} consumer
 * @param {{ name: string, exports: Record<string, unknown> }} metadata
 * @param {string} table README API table rows
 * @param {Set<string>} headings anchors of every docs/ page
 * @param {(ok: boolean, message: string) => void} expect
 */
function checkExports(consumer, metadata, table, headings, expect) {
  const entries = Object.keys(metadata.exports).filter(
    (key) => key !== "./package.json" && !key.endsWith(".js"),
  );
  const probe = join(consumer, "documentation-probe.ts");
  writeFileSync(
    probe,
    entries.map((key, index) => `import * as e${String(index)} from "${metadata.name}${key.slice(1)}";`).join("\n"),
  );
  const program = ts.createProgram([probe], {
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    types: ["vite/client"],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(probe);
  const imports = source?.statements.filter((node) => ts.isImportDeclaration(node)) ?? [];
  /** @param {ts.Symbol} symbol */
  const summary = (symbol) => ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim().length > 0;
  const page = `${OSS}/packages/${metadata.name.split("/").at(-1)}`;
  let seeFound = false;
  imports.forEach((statement, index) => {
    const entry = String(entries[index]);
    const module = checker.getSymbolAtLocation(statement.moduleSpecifier);
    expect(module !== undefined, `cannot resolve the entry point ${entry}`);
    if (module === undefined) return;
    const symbols = checker.getExportsOfModule(module);
    expect(symbols.length > 0, `${entry} exports nothing`);
    symbols.forEach((symbol) => {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const isDefault = symbol.name === "default";
      const label = isDefault ? `${entry.slice(2)} default export` : symbol.name;
      expect(summary(target) || summary(symbol), `${entry}: ${label} has no TSDoc summary`);
      const row = isDefault
        ? table.split("\n").some((line) => line.includes("`default") && line.includes(`\`${metadata.name}${entry.slice(1)}\``))
        : table.includes(`\`${symbol.name}\``);
      expect(row, `README API table lacks ${label} (${entry})`);
      expect(headings.has(slug(label)), `docs/ has no heading for ${label} (${entry})`);
      if (entry === "." && target.getJsDocTags(checker).some((tag) => tag.name === "see" && ts.displayPartsToString(tag.text).includes(page))) {
        seeFound = true;
      }
      if (!(target.flags & ts.SymbolFlags.Class)) return;
      checker
        .getDeclaredTypeOfSymbol(target)
        .getProperties()
        .filter((member) => {
          const declaration = member.declarations?.[0];
          if (!(member.flags & ts.SymbolFlags.Method) || declaration === undefined) return false;
          return !(ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.NonPublicAccessibilityModifier);
        })
        .forEach((method) => {
          expect(summary(method), `${symbol.name}.${method.name} has no TSDoc summary`);
          expect(table.includes(`\`${method.name}(`), `README API table lacks ${method.name}(`);
          expect(headings.has(slug(method.name)), `docs/ has no heading for ${method.name}`);
        });
    });
  });
  expect(seeFound, `an export of the main entry needs TSDoc @see ${page}`);
}

/**
 * Write stub Convex host files plus every example, then type-check them against the installed
 * package. Returns the diagnostics as failure messages.
 * @param {string} installed
 * @param {string} consumer
 * @param {{ code: string, path: string, file: string, line: number }[]} examples
 */
export function compileExamples(installed, consumer, examples) {
  const metadata = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  const definition = /defineComponent\(\s*"([^"]+)"/u.exec(
    readFileSync(join(installed, "src/component/convex.config.ts"), "utf8"),
  )?.[1];
  if (definition === undefined) return ["cannot read the component name from src/component/convex.config.ts"];
  const mounts = new Set(
    examples
      .filter(({ path }) => path.endsWith("convex.config.ts"))
      .flatMap(({ code }) => [...code.matchAll(/app\.use\(\s*\w+\s*(?:,\s*\{([^}]*)\})?\s*\)/gu)])
      .map((match) => /name:\s*"([^"]+)"/u.exec(match[1] ?? "")?.[1] ?? definition),
  );
  const modules = [...new Set(examples.map(({ path }) => path))].filter(
    (path) => path.startsWith("convex/") && !/convex\.config|\.test\.|_generated|schema/u.test(path),
  );
  const moduleKeys = modules.map((path) => path.slice("convex/".length).replace(/\.tsx?$/u, ""));
  const api = [
    `import type { ComponentApi } from "${metadata.name}/_generated/component.js";`,
    `import { anyApi, componentsGeneric, type ApiFromModules, type FilterApi, type FunctionReference } from "convex/server";`,
    ...moduleKeys.map((key, index) => `import type * as m${String(index)} from "../${key}.js";`),
    `type FullApi = ApiFromModules<{ ${moduleKeys.map((key, index) => `"${key}": typeof m${String(index)};`).join(" ")} }>;`,
    `export const api = anyApi as unknown as FilterApi<FullApi, FunctionReference<any, "public">>;`,
    `export const internal = anyApi as unknown as FilterApi<FullApi, FunctionReference<any, "internal">>;`,
    `export const components = componentsGeneric() as unknown as { ${[...mounts].map((mount) => `"${mount}": ComponentApi;`).join(" ")} };`,
  ];
  /** @type {[string, string][]} */
  const files = [
    ["convex/_generated/api.ts", `${api.join("\n")}\n`],
    [
      "convex/_generated/server.ts",
      `export { actionGeneric as action, httpActionGeneric as httpAction, internalActionGeneric as internalAction, internalMutationGeneric as internalMutation, internalQueryGeneric as internalQuery, mutationGeneric as mutation, queryGeneric as query } from "convex/server";\n`,
    ],
    ["convex/schema.ts", `import { defineSchema } from "convex/server";\nexport default defineSchema({});\n`],
  ];
  /** @type {Map<string, { file: string, line: number }>} written path -> fence location */
  const origin = new Map();
  /** @type {Map<string, number>} */
  const seen = new Map();
  examples.forEach(({ code, path, file, line }) => {
    const copies = seen.get(path) ?? 0;
    seen.set(path, copies + 1);
    const target = copies === 0 ? path : path.replace(/(\.tsx?)$/u, `.${String(copies)}$1`);
    origin.set(join(consumer, target), { file, line });
    files.push([target, code]);
  });
  files.forEach(([path, code]) => {
    mkdirSync(dirname(join(consumer, path)), { recursive: true });
    writeFileSync(join(consumer, path), code);
  });
  const program = ts.createProgram(
    files.map(([path]) => join(consumer, path)),
    {
      jsx: ts.JsxEmit.ReactJSX,
      lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      types: ["vite/client"],
    },
  );
  return ts.getPreEmitDiagnostics(program).map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (diagnostic.file === undefined || diagnostic.start === undefined) return `tsc: ${message}`;
    const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const fence = origin.get(diagnostic.file.fileName);
    const where = fence
      ? `${fence.file}:${String(fence.line + line + 1)}`
      : `${relative(consumer, diagnostic.file.fileName)}:${String(line + 1)}`;
    return `${where}: ${message}`;
  });
}
