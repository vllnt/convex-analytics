/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { api } from "../src/component/_generated/api.js";
import { AnalyticsClient } from "../src/client/index.js";
import { initConvexTest } from "./test-helpers.js";

const D = (day: number) => Date.UTC(2026, 0, day, 10, 0, 0);

/**
 * The client passes `component.mutations.X` refs through. In convex-test the
 * analytics component is the test root, so the component's own generated `api`
 * serves as the `component` object whose refs resolve at the root.
 */
function makeClient<P extends Record<string, string | number | boolean | null>>(
  config: ConstructorParameters<typeof AnalyticsClient>[1] = {},
): AnalyticsClient<P> {
  return new AnalyticsClient<P>(api, config);
}

describe("AnalyticsClient", () => {
  it("applies configured scope, dimensions, and granularities on track", async () => {
    const t = initConvexTest();
    const analytics = makeClient<{ plan: string }>({
      scope: "tenant-a",
      dimensions: ["plan"],
      granularities: ["hour", "day"],
    });

    const result = await t.run(async (ctx) =>
      analytics.track(ctx, "signup", { subjectRef: "u1", props: { plan: "pro" }, ts: D(1) }),
    );
    expect(result).toBe("tracked");

    const total = await t.run(async (ctx) => analytics.metric(ctx, "signup"));
    expect(total).toBe(1);

    const top = await t.run(async (ctx) => analytics.top(ctx, "signup", "plan"));
    expect(top).toEqual([{ value: "pro", count: 1 }]);

    const other = await t.run(async (ctx) => analytics.metric(ctx, "signup", { scope: "tenant-b" }));
    expect(other).toBe(0);
  });

  it("defaults scope to 'default' and granularities to [day]", async () => {
    const t = initConvexTest();
    const analytics = makeClient();
    await t.run(async (ctx) => analytics.track(ctx, "e", { ts: D(1) }));
    const ts = await t.run(async (ctx) =>
      analytics.timeseries(ctx, "e", { granularity: "day", range: {} }),
    );
    expect(ts).toHaveLength(1);
  });

  it("track honors a per-call scope override and a sampleRate from config", async () => {
    const t = initConvexTest();
    const analytics = makeClient({ sampleRate: 1 });
    const r = await t.run(async (ctx) => analytics.track(ctx, "e", { scope: "x", ts: D(1) }));
    expect(r).toBe("tracked");
    expect(await t.run(async (ctx) => analytics.metric(ctx, "e", { scope: "x" }))).toBe(1);
  });

  it("metric supports range + where", async () => {
    const t = initConvexTest();
    const analytics = makeClient<{ plan: string }>({ dimensions: ["plan"] });
    await t.run(async (ctx) => {
      await analytics.track(ctx, "e", { props: { plan: "pro" }, ts: D(1) });
      await analytics.track(ctx, "e", { props: { plan: "free" }, ts: D(5) });
    });
    expect(
      await t.run(async (ctx) =>
        analytics.metric(ctx, "e", { range: { from: D(1), to: D(2) } }),
      ),
    ).toBe(1);
    expect(
      await t.run(async (ctx) => analytics.metric(ctx, "e", { where: { dim: "plan", val: "pro" } })),
    ).toBe(1);
  });

  it("exposes timeseries/uniques/funnel/retention/list verbs", async () => {
    const t = initConvexTest();
    const analytics = makeClient();
    await t.run(async (ctx) => {
      await analytics.track(ctx, "visit", { subjectRef: "u1", ts: D(1) });
      await analytics.track(ctx, "buy", { subjectRef: "u1", ts: D(2) });
    });

    const ts = await t.run(async (ctx) =>
      analytics.timeseries(ctx, "visit", { granularity: "day", range: {} }),
    );
    expect(ts).toHaveLength(1);

    const u = await t.run(async (ctx) =>
      analytics.uniques(ctx, { range: { from: D(1), to: D(3) }, granularity: "day" }),
    );
    expect(u.mau).toBe(1);

    const f = await t.run(async (ctx) =>
      analytics.funnel(ctx, ["visit", "buy"], { range: { from: D(1), to: D(3) } }),
    );
    expect(f[1]!.count).toBe(1);

    const r = await t.run(async (ctx) =>
      analytics.retention(ctx, { cohortRange: { from: D(1), to: D(3) }, periods: 2 }),
    );
    expect(r.length).toBeGreaterThanOrEqual(1);

    const page = await t.run(async (ctx) =>
      analytics.list(ctx, "visit", { numItems: 10, cursor: null }),
    );
    expect(page.page).toHaveLength(1);
  });

  it("exposes the distribution verb", async () => {
    const t = initConvexTest();
    const analytics = makeClient<{ tries: number }>();
    await t.run(async (ctx) => {
      await analytics.track(ctx, "attempt", { props: { tries: 1 }, ts: D(1) });
      await analytics.track(ctx, "attempt", { props: { tries: 9 }, ts: D(2) });
    });
    const d = await t.run(async (ctx) =>
      analytics.distribution(ctx, "attempt", "tries", { buckets: [5, 10] }),
    );
    expect(d.count).toBe(2);
    expect(d.sum).toBe(10);
    expect(d.bins).toEqual([
      { upper: 5, count: 1 },
      { upper: 10, count: 1 },
    ]);
  });

  it("configure persists config from explicit opts and from constructor defaults", async () => {
    const t = initConvexTest();
    const analytics = makeClient({ retentionDays: 45, sampleRate: 0.5, sessionIdleMs: 2000 });
    await t.run(async (ctx) => analytics.configure(ctx));
    expect(await t.query(api.queries.configGet, { scope: "default", key: "retentionDays" })).toBe("45");
    expect(await t.query(api.queries.configGet, { scope: "default", key: "sampleRate" })).toBe("0.5");

    await t.run(async (ctx) => analytics.configure(ctx, { retentionDays: 10, scope: "other" }));
    expect(await t.query(api.queries.configGet, { scope: "other", key: "retentionDays" })).toBe("10");
  });
});
