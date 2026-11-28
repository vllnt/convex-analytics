/// <reference types="vite/client" />
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import aggregateTest from "@convex-dev/aggregate/test";
import shardedCounterTest from "@convex-dev/sharded-counter/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register the convex-analytics component (and its child components) with a
 * convex-test instance. Child components are registered under nested paths
 * (`<name>/aggregate`, `<name>/shardedCounter`, `<name>/rateLimiter`) so that
 * `track`'s sharded-counter and rate-limiter calls resolve end-to-end. The aggregate child is
 * mounted by the component, so it is registered too, though nothing calls it.
 *
 * @example
 * ```ts
 * import analyticsTest from "@vllnt/convex-analytics/test";
 * import { convexTest } from "convex-test";
 *
 * const t = convexTest(hostSchema, hostModules);
 * analyticsTest.register(t);
 * ```
 */
export function register(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  name: string = "analytics",
): void {
  t.registerComponent(name, schema, modules);
  t.registerComponent(`${name}/aggregate`, aggregateTest.schema, aggregateTest.modules);
  t.registerComponent(
    `${name}/shardedCounter`,
    shardedCounterTest.schema,
    shardedCounterTest.modules,
  );
  t.registerComponent(
    `${name}/rateLimiter`,
    rateLimiterTest.schema,
    rateLimiterTest.modules,
  );
}

/** `register`, plus the component `schema` and `modules` for calling `t.registerComponent` yourself. */
export default { register, schema, modules };
