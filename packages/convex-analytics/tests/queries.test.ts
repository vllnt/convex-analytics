/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { api } from "../src/component/_generated/api.js";
import { initConvexTest } from "./test-helpers.js";

const D = (day: number, hour = 10) => Date.UTC(2026, 0, day, hour, 0, 0);

async function seed(
  t: ReturnType<typeof initConvexTest>,
  rows: Array<{
    name?: string;
    subjectRef?: string;
    props?: Record<string, string | number | boolean | null>;
    ts: number;
    dimensions?: string[];
    granularities?: ("minute" | "hour" | "day")[];
  }>,
): Promise<void> {
  for (const r of rows) {
    await t.mutation(api.mutations.track, {
      scope: "default",
      name: r.name ?? "view",
      subjectRef: r.subjectRef,
      props: r.props,
      ts: r.ts,
      dimensions: r.dimensions ?? [],
      granularities: r.granularities ?? ["day"],
    });
  }
}

describe("metric", () => {
  it("uses the sharded counter for an unfiltered, unranged total", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: D(1) }, { ts: D(2) }, { ts: D(3) }]);
    expect(await t.query(api.queries.metric, { scope: "default", name: "view" })).toBe(3);
  });

  it("sums day rollups within an inclusive range", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: D(1) }, { ts: D(2) }, { ts: D(5) }]);
    const r = await t.query(api.queries.metric, {
      scope: "default",
      name: "view",
      range: { from: D(2), to: D(2, 23) },
    });
    expect(r).toBe(1);
  });

  it("filters by a dimension value via where", async () => {
    const t = initConvexTest();
    await seed(t, [
      { ts: D(1), props: { plan: "pro" }, dimensions: ["plan"] },
      { ts: D(1), props: { plan: "free" }, dimensions: ["plan"] },
      { ts: D(1), props: { plan: "pro" }, dimensions: ["plan"] },
    ]);
    expect(
      await t.query(api.queries.metric, {
        scope: "default", name: "view", where: { dim: "plan", val: "pro" },
      }),
    ).toBe(2);
  });

  it("honors only-from and only-to bounds", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: D(1) }, { ts: D(5) }, { ts: D(9) }]);
    expect(
      await t.query(api.queries.metric, { scope: "default", name: "view", range: { from: D(5) } }),
    ).toBe(2);
    expect(
      await t.query(api.queries.metric, { scope: "default", name: "view", range: { to: D(5, 23) } }),
    ).toBe(2);
  });
});

describe("top", () => {
  it("ranks dimension values by count and respects limit", async () => {
    const t = initConvexTest();
    await seed(t, [
      { ts: D(1), props: { c: "a" }, dimensions: ["c"] },
      { ts: D(1), props: { c: "a" }, dimensions: ["c"] },
      { ts: D(1), props: { c: "b" }, dimensions: ["c"] },
      { ts: D(1), props: { c: "x" }, dimensions: ["c"] },
    ]);
    const all = await t.query(api.queries.top, { scope: "default", name: "view", dimension: "c" });
    expect(all[0]).toEqual({ value: "a", count: 2 });
    const limited = await t.query(api.queries.top, {
      scope: "default", name: "view", dimension: "c", limit: 1,
    });
    expect(limited).toHaveLength(1);
  });

  it("filters rollups by range, excluding buckets above the to bound", async () => {
    const t = initConvexTest();
    await seed(t, [
      { ts: D(1), props: { c: "a" }, dimensions: ["c"] },
      { ts: D(9), props: { c: "a" }, dimensions: ["c"] },
      { ts: D(20), props: { c: "a" }, dimensions: ["c"] },
    ]);
    const r = await t.query(api.queries.top, {
      scope: "default", name: "view", dimension: "c", range: { from: D(8), to: D(10) },
    });
    expect(r).toEqual([{ value: "a", count: 1 }]);
  });
});

describe("timeseries", () => {
  it("buckets by day and sorts ascending", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: D(3) }, { ts: D(1) }, { ts: D(1) }]);
    const r = await t.query(api.queries.timeseries, {
      scope: "default", name: "view", granularity: "day", range: {},
    });
    expect(r.map((p) => p.count)).toEqual([2, 1]);
    expect(r[0]!.bucket).toBeLessThan(r[1]!.bucket);
  });

  it("filters by a dimension value and by range bounds", async () => {
    const t = initConvexTest();
    await seed(t, [
      { ts: D(1), props: { c: "a" }, dimensions: ["c"] },
      { ts: D(1), props: { c: "b" }, dimensions: ["c"] },
      { ts: D(9), props: { c: "a" }, dimensions: ["c"] },
    ]);
    const r = await t.query(api.queries.timeseries, {
      scope: "default", name: "view", granularity: "day",
      range: { from: D(1), to: D(1, 23) }, where: { dim: "c", val: "a" },
    });
    expect(r).toEqual([{ bucket: Date.UTC(2026, 0, 1), count: 1 }]);
  });

  it("excludes buckets below the from bound", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: D(1) }, { ts: D(9) }]);
    const r = await t.query(api.queries.timeseries, {
      scope: "default", name: "view", granularity: "day", range: { from: D(5) },
    });
    expect(r).toEqual([{ bucket: Date.UTC(2026, 0, 9), count: 1 }]);
  });
});

describe("uniques", () => {
  it("computes DAU/WAU/MAU + a trend from subjects", async () => {
    const t = initConvexTest();
    await seed(t, [
      { ts: D(1), subjectRef: "u1" },
      { ts: D(1), subjectRef: "u2" },
      { ts: D(2), subjectRef: "u3" },
    ]);
    const r = await t.query(api.queries.uniques, {
      scope: "default", granularity: "day", range: { from: D(1), to: D(2, 23) },
    });
    expect(r.mau).toBe(3);
    expect(r.trend).toHaveLength(2);
    expect(r.dau).toBeGreaterThan(0);
  });

  it("returns zeros when no subjects fall in range", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: D(1), subjectRef: "u1" }]);
    const r = await t.query(api.queries.uniques, {
      scope: "default", granularity: "day", range: { from: D(20), to: D(25) },
    });
    expect(r).toEqual({ dau: 0, wau: 0, mau: 0, trend: [] });
  });

  it("defaults the range to the last 30 days when omitted", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: Date.now() - 1000, subjectRef: "u1" }]);
    const r = await t.query(api.queries.uniques, { scope: "default", granularity: "day", range: {} });
    expect(r.mau).toBe(1);
  });

  it("excludes subjects last-seen before the WAU/MAU cutoffs", async () => {
    const t = initConvexTest();
    const now = Date.now();
    const old = now - 45 * 86400000;
    await seed(t, [{ ts: old, subjectRef: "old" }]);
    const r = await t.query(api.queries.uniques, {
      scope: "default", granularity: "day", range: { from: old - 1000, to: now },
    });
    expect(r.mau).toBe(0);
    expect(r.wau).toBe(0);
    expect(r.trend).toHaveLength(1);
  });
});

describe("funnel", () => {
  it("computes ordered step conversion keyed by subjectRef", async () => {
    const t = initConvexTest();
    await seed(t, [
      { name: "visit", subjectRef: "u1", ts: D(1, 1) },
      { name: "visit", subjectRef: "u2", ts: D(1, 1) },
      { name: "signup", subjectRef: "u1", ts: D(1, 2) },
    ]);
    const r = await t.query(api.queries.funnel, {
      scope: "default", steps: ["visit", "signup"], range: { from: D(1, 0), to: D(2) },
    });
    expect(r[0]).toEqual({ name: "visit", count: 2, rate: 1 });
    expect(r[1]).toEqual({ name: "signup", count: 1, rate: 0.5 });
  });

  it("ignores out-of-order step completions", async () => {
    const t = initConvexTest();
    await seed(t, [
      { name: "a", subjectRef: "u1", ts: D(2) },
      { name: "b", subjectRef: "u1", ts: D(1) },
    ]);
    const r = await t.query(api.queries.funnel, {
      scope: "default", steps: ["a", "b"], range: { from: D(1), to: D(3) },
    });
    expect(r[1]!.count).toBe(0);
  });

  it("throws with fewer than 2 steps", async () => {
    const t = initConvexTest();
    await expect(
      t.query(api.queries.funnel, { scope: "default", steps: ["only"], range: {} }),
    ).rejects.toThrow(/at least 2 steps/);
  });

  it("defaults the range when omitted and skips events without subjectRef", async () => {
    const t = initConvexTest();
    const now = Date.now();
    await seed(t, [
      { name: "a", subjectRef: "u1", ts: now - 1000 },
      { name: "a", ts: now - 1000 },
      { name: "b", subjectRef: "u1", ts: now },
    ]);
    const r = await t.query(api.queries.funnel, {
      scope: "default", steps: ["a", "b"], range: {},
    });
    expect(r[0]!.count).toBe(1);
    expect(r[1]!.count).toBe(1);
  });

  it("keeps the earliest timestamp per subject for a step", async () => {
    const t = initConvexTest();
    await seed(t, [
      { name: "a", subjectRef: "u1", ts: D(2) },
      { name: "a", subjectRef: "u1", ts: D(1) },
      { name: "b", subjectRef: "u1", ts: D(1, 12) },
    ]);
    const r = await t.query(api.queries.funnel, {
      scope: "default", steps: ["a", "b"], range: { from: D(1, 0), to: D(3) },
    });
    expect(r[1]!.count).toBe(1);
  });

  it("reports rate 0 for all steps when the first step has no subjects", async () => {
    const t = initConvexTest();
    await seed(t, [{ name: "b", subjectRef: "u1", ts: D(1) }]);
    const r = await t.query(api.queries.funnel, {
      scope: "default", steps: ["a", "b"], range: { from: D(1, 0), to: D(3) },
    });
    expect(r[0]).toEqual({ name: "a", count: 0, rate: 1 });
    expect(r[1]).toEqual({ name: "b", count: 0, rate: 0 });
  });
});

describe("retention", () => {
  it("groups cohorts by first-seen period and computes return rates", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: D(1), subjectRef: "u1" }]);
    await seed(t, [{ ts: D(2), subjectRef: "u1" }]);
    const r = await t.query(api.queries.retention, {
      scope: "default", cohortRange: { from: D(1), to: D(3) }, periods: 2, granularity: "day",
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.size).toBe(1);
    expect(r[0]!.retained[0]).toBe(1);
  });

  it("defaults granularity to day and clamps the from bound", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: D(1), subjectRef: "u1" }]);
    const r = await t.query(api.queries.retention, {
      scope: "default", cohortRange: { to: D(2) }, periods: 1,
    });
    expect(r.length).toBeGreaterThanOrEqual(1);
  });

  it("defaults the to bound to now when omitted", async () => {
    const t = initConvexTest();
    const now = Date.now();
    await seed(t, [{ ts: now - 2 * 86400000, subjectRef: "u1" }]);
    const r = await t.query(api.queries.retention, {
      scope: "default", cohortRange: { from: now - 5 * 86400000 }, periods: 2,
    });
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
});

describe("list", () => {
  it("paginates raw events newest-first", async () => {
    const t = initConvexTest();
    await seed(t, [{ ts: D(1) }, { ts: D(2) }, { ts: D(3) }]);
    const first = await t.query(api.queries.list, {
      scope: "default", name: "view", paginationOpts: { numItems: 2, cursor: null },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    expect(first.page[0]!.ts).toBeGreaterThan(first.page[1]!.ts);

    const second = await t.query(api.queries.list, {
      scope: "default", name: "view",
      paginationOpts: { numItems: 2, cursor: first.continueCursor },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
  });

  it("returns the full event view shape including optional fields", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.track, {
      scope: "default", name: "view", subjectRef: "u1", sessionRef: "s1",
      props: { a: "b" }, ts: D(1), dedupeKey: "dk", dimensions: [], granularities: ["day"],
    });
    const page = await t.query(api.queries.list, {
      scope: "default", name: "view", paginationOpts: { numItems: 10, cursor: null },
    });
    const e = page.page[0]!;
    expect(e.subjectRef).toBe("u1");
    expect(e.sessionRef).toBe("s1");
    expect(e.dedupeKey).toBe("dk");
    expect(e.props).toEqual({ a: "b" });
    expect(typeof e._id).toBe("string");
  });

  it("returns an empty page (done, no cursor) for a name with no events", async () => {
    const t = initConvexTest();
    const page = await t.query(api.queries.list, {
      scope: "default", name: "nope", paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toEqual([]);
    expect(page.isDone).toBe(true);
    expect(page.continueCursor).toBe("");
  });
});

describe("configGet", () => {
  it("returns a stored value and null for an unknown key", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configSet, { scope: "s", key: "k", value: "v" });
    expect(await t.query(api.queries.configGet, { scope: "s", key: "k" })).toBe("v");
    expect(await t.query(api.queries.configGet, { scope: "s", key: "nope" })).toBeNull();
  });
});

describe("minute granularity", () => {
  it("rolls up on write and reads a timeseries at minute resolution", async () => {
    const t = initConvexTest();
    const m = (min: number) => Date.UTC(2026, 0, 1, 10, min, 0);
    await seed(t, [
      { name: "live", ts: m(0), granularities: ["minute"] },
      { name: "live", ts: m(0), granularities: ["minute"] },
      { name: "live", ts: m(1), granularities: ["minute"] },
    ]);
    const ts = await t.query(api.queries.timeseries, {
      scope: "default",
      name: "live",
      granularity: "minute",
      range: { from: m(0), to: m(5) },
    });
    expect(ts).toEqual([
      { bucket: m(0), count: 2 },
      { bucket: m(1), count: 1 },
    ]);
  });
});

describe("distribution", () => {
  it("buckets a numeric measure into ascending bins + overflow, with sum/count", async () => {
    const t = initConvexTest();
    await seed(t, [
      { name: "attempt", props: { tries: 1 }, ts: D(1) },
      { name: "attempt", props: { tries: 2 }, ts: D(1) },
      { name: "attempt", props: { tries: 2 }, ts: D(2) },
      { name: "attempt", props: { tries: 5 }, ts: D(2) },
      { name: "attempt", props: { tries: 99 }, ts: D(3) }, // overflow (> 10)
      { name: "attempt", props: { tries: "nope" }, ts: D(3) }, // non-numeric → ignored
      { name: "attempt", ts: D(3) }, // measure missing → ignored
    ]);
    const d = await t.query(api.queries.distribution, {
      scope: "default",
      name: "attempt",
      measure: "tries",
      buckets: [3, 1, 2, 10], // unsorted → sorted to [1,2,3,10]
    });
    expect(d.bins).toEqual([
      { upper: 1, count: 1 },
      { upper: 2, count: 2 },
      { upper: 3, count: 0 },
      { upper: 10, count: 1 }, // tries=5 → first bin >=5 is 10
    ]);
    expect(d.overflow).toBe(1); // tries=99
    expect(d.count).toBe(5); // 1,2,2,5,99
    expect(d.sum).toBe(109);
  });

  it("respects a range and a where filter", async () => {
    const t = initConvexTest();
    await seed(t, [
      { name: "attempt", props: { tries: 1, plan: "pro" }, ts: D(1) },
      { name: "attempt", props: { tries: 2, plan: "free" }, ts: D(2) },
      { name: "attempt", props: { tries: 3, plan: "pro" }, ts: D(9) },
    ]);
    const ranged = await t.query(api.queries.distribution, {
      scope: "default", name: "attempt", measure: "tries", buckets: [10],
      range: { from: D(1), to: D(2, 23) },
    });
    expect(ranged.count).toBe(2); // D(9) excluded by range

    const filtered = await t.query(api.queries.distribution, {
      scope: "default", name: "attempt", measure: "tries", buckets: [10],
      where: { dim: "plan", val: "pro" },
    });
    expect(filtered.count).toBe(2); // plan=free dropped
    expect(filtered.sum).toBe(4); // tries 1 + 3
  });

  it("skips events missing the where dimension", async () => {
    const t = initConvexTest();
    await seed(t, [
      { name: "attempt", props: { tries: 1 }, ts: D(1) }, // no plan prop
      { name: "attempt", props: { tries: 2, plan: "pro" }, ts: D(1) },
    ]);
    const d = await t.query(api.queries.distribution, {
      scope: "default", name: "attempt", measure: "tries", buckets: [10],
      where: { dim: "plan", val: "pro" },
    });
    expect(d.count).toBe(1);
    expect(d.sum).toBe(2);
  });

  it("returns zero-count bins when there are no matching events", async () => {
    const t = initConvexTest();
    const d = await t.query(api.queries.distribution, {
      scope: "default", name: "none", measure: "x", buckets: [1, 2],
    });
    expect(d).toEqual({
      bins: [{ upper: 1, count: 0 }, { upper: 2, count: 0 }],
      overflow: 0,
      count: 0,
      sum: 0,
    });
  });
});
