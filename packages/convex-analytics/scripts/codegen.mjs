import { spawnSync } from "node:child_process";
import { mkdirSync, rmdirSync } from "node:fs";

const syntheticFunctionsDir = "convex";
let createdSyntheticDir = false;

try {
  try {
    mkdirSync(syntheticFunctionsDir);
    createdSyntheticDir = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  const forwardedArgs = process.argv.slice(2);
  if (forwardedArgs[0] === "--") forwardedArgs.shift();

  const result = spawnSync(
    "convex",
    ["codegen", "--component-dir", "./src/component", ...forwardedArgs],
    { stdio: "inherit" },
  );

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (createdSyntheticDir) rmdirSync(syntheticFunctionsDir);
}
