/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../src/component/schema.js";

const modules = import.meta.glob("../src/component/**/*.ts");

/**
 * Create a fresh convex-test instance for component testing.
 * Each test gets its own instance — full isolation, no shared state.
 */
export function initConvexTest() {
  return convexTest(schema, modules);
}
