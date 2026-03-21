/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the convex-analytics component with a convex-test instance.
 *
 * @example
 * ```typescript
 * import analyticsTest from "convex-analytics/test";
 * import { convexTest } from "convex-test";
 *
 * function initTest() {
 *   const t = convexTest();
 *   analyticsTest.register(t);
 *   return t;
 * }
 * ```
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "analytics",
): void {
  t.registerComponent(name, schema, modules);
}

export default { register, schema, modules };
