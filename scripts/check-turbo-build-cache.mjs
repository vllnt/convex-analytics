/**
 * The package `build` copies the repo-root README.md, LICENSE, llms.txt and docs/ into
 * packages/convex-analytics/. Ask turbo (dry run, nothing is built) how it caches that
 * task, and fail unless every copied root file is a hashed input (so editing it misses the
 * cache) and every copy is a cached output (so a cache hit restores it, not only dist/).
 * Fix: list them under "@vllnt/convex-analytics#build" `inputs` / `outputs` in turbo.json.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const TASK = "@vllnt/convex-analytics#build";
const copied = ["README.md", "LICENSE", "llms.txt", ...readdirSync("docs").map((name) => `docs/${name}`)];

const plan = JSON.parse(
  execFileSync("pnpm", ["exec", "turbo", "run", "build", "--dry=json", "--filter=@vllnt/convex-analytics"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }),
);
const task = plan.tasks.find((entry) => entry.taskId === TASK);
if (!task) throw new Error(`turbo dry run has no ${TASK} task`);

/** @param {string} path */
const isOutput = (path) =>
  task.outputs.some((glob) => glob === path || (glob.endsWith("/**") && path.startsWith(glob.slice(0, -2))));

const failures = [];
for (const path of copied) {
  if (!(`../../${path}` in task.inputs)) failures.push(`root ${path} is not a ${TASK} input`);
  if (!isOutput(path)) failures.push(`copied ${path} is not a ${TASK} output`);
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.stderr.write(`Fix: add the root files to ${TASK} inputs and the copies to its outputs in turbo.json.\n`);
  process.exit(1);
}
process.stdout.write(`OK    ${TASK} hashes and caches ${copied.length} copied root files\n`);
