/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import aggregateTest from "@convex-dev/aggregate/test";
import shardedCounterTest from "@convex-dev/sharded-counter/test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import schema from "../src/component/schema.js";

const modules = import.meta.glob("../src/component/**/*.ts");

/**
 * Create a convex-test instance with the analytics component as the root and
 * its child components (aggregate / shardedCounter / rateLimiter) registered so
 * `track`'s cross-component calls resolve end-to-end.
 *
 * The component schema is the test root, so children resolve at root-relative
 * paths (`aggregate`, `shardedCounter`, `rateLimiter`).
 */
export function initConvexTest(): ReturnType<typeof convexTest> {
  const t = convexTest(schema, modules);
  t.registerComponent("aggregate", aggregateTest.schema, aggregateTest.modules);
  t.registerComponent(
    "shardedCounter",
    shardedCounterTest.schema,
    shardedCounterTest.modules,
  );
  t.registerComponent(
    "rateLimiter",
    rateLimiterTest.schema,
    rateLimiterTest.modules,
  );
  return t;
}
