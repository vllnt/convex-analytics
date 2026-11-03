import { describe, it, expect } from "vitest";
import pkg from "../package.json";

// The Convex Components Directory preflight requires both subpaths below.
const exportsMap = pkg.exports as Record<string, unknown>;

describe("package.json exports", () => {
  it("exports ./convex.config.js with the same target as ./convex.config", () => {
    expect(exportsMap["./convex.config"]).toBeDefined();
    expect(exportsMap["./convex.config.js"]).toEqual(exportsMap["./convex.config"]);
  });

  it("exports ./_generated/component.js", () => {
    expect(exportsMap["./_generated/component.js"]).toBeDefined();
  });
});
