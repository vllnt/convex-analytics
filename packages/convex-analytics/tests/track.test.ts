/// <reference types="vite/client" />
import { describe, it, expect, vi, afterEach } from "vitest";
import { api } from "../src/component/_generated/api.js";
import { initConvexTest } from "./test-helpers.js";

const DAY = Date.UTC(2026, 0, 15, 10, 0, 0);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("track — rollup-on-write", () => {
  it("inserts raw event, bumps total counter, rolls up declared dims (hour+day)", async () => {
    const t = initConvexTest();
    const result = await t.mutation(api.mutations.track, {
      scope: "default",
      name: "signup",
      subjectRef: "u1",
      props: { plan: "pro", source: "ad" },
      ts: DAY,
      dimensions: ["plan", "source"],
      granularities: ["hour", "day"],
    });
    expect(result).toBe("tracked");

    expect(await t.query(api.queries.metric, { scope: "default", name: "signup" })).toBe(1);
    expect(
      await t.query(api.queries.metric, {
        scope: "default",
        name: "signup",
        where: { dim: "plan", val: "pro" },
      }),
    ).toBe(1);
    expect(
      await t.query(api.queries.top, { scope: "default", name: "signup", dimension: "source" }),
    ).toEqual([{ value: "ad", count: 1 }]);

    const hourly = await t.query(api.queries.timeseries, {
      scope: "default",
      name: "signup",
      granularity: "hour",
      range: {},
    });
    expect(hourly).toHaveLength(1);
    expect(hourly[0]!.count).toBe(1);
  });

  it("defaults ts to now, props to {}, granularities to [day] when empty", async () => {
    const t = initConvexTest();
    const before = Date.now();
    const r = await t.mutation(api.mutations.track, {
      scope: "s",
      name: "ping",
      dimensions: [],
      granularities: [],
    });
    expect(r).toBe("tracked");
    const page = await t.query(api.queries.list, {
      scope: "s",
      name: "ping",
      paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(1);
    expect(page.page[0]!.props).toEqual({});
    expect(page.page[0]!.ts).toBeGreaterThanOrEqual(before);
  });

  it("upserts a subject (firstSeen/lastSeen/eventCount) across two events", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.track, {
      scope: "default", name: "e", subjectRef: "u1", ts: DAY,
      dimensions: [], granularities: ["day"],
    });
    await t.mutation(api.mutations.track, {
      scope: "default", name: "e", subjectRef: "u1", ts: DAY - 1000,
      dimensions: [], granularities: ["day"],
    });
    const subjects = await t.run(async (ctx) =>
      ctx.db.query("subjects").withIndex("by_scope_subject", (q) =>
        q.eq("scope", "default").eq("subjectRef", "u1"),
      ).unique(),
    );
    expect(subjects!.eventCount).toBe(2);
    expect(subjects!.firstSeen).toBe(DAY - 1000);
    expect(subjects!.lastSeen).toBe(DAY);
  });

  it("upserts a session and derives seq from the session event count", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.track, {
      scope: "default", name: "e", sessionRef: "sess1", subjectRef: "u1", ts: DAY,
      dimensions: [], granularities: ["day"],
    });
    await t.mutation(api.mutations.track, {
      scope: "default", name: "e", sessionRef: "sess1", ts: DAY + 1000,
      dimensions: [], granularities: ["day"],
    });
    const page = await t.query(api.queries.list, {
      scope: "default", name: "e", paginationOpts: { numItems: 10, cursor: null },
    });
    const seqs = page.page.map((e) => e.seq).sort();
    expect(seqs).toEqual([0, 1]);

    const session = await t.run(async (ctx) =>
      ctx.db.query("sessions").withIndex("by_scope_session", (q) =>
        q.eq("scope", "default").eq("sessionRef", "sess1"),
      ).unique(),
    );
    expect(session!.eventCount).toBe(2);
    expect(session!.subjectRef).toBe("u1");
  });

  it("drops by sampleRate when the sampler rolls above the rate", async () => {
    const t = initConvexTest();
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const r = await t.mutation(api.mutations.track, {
      scope: "s", name: "e", sampleRate: 0.1,
      dimensions: [], granularities: ["day"],
    });
    expect(r).toBe("dropped");
    expect(await t.query(api.queries.metric, { scope: "s", name: "e" })).toBe(0);
  });

  it("keeps the event when the sampler rolls below the rate", async () => {
    const t = initConvexTest();
    vi.spyOn(Math, "random").mockReturnValue(0.05);
    const r = await t.mutation(api.mutations.track, {
      scope: "s", name: "e", sampleRate: 0.1, ts: DAY,
      dimensions: [], granularities: ["day"],
    });
    expect(r).toBe("tracked");
  });

  it("returns 'duplicate' when a dedupeKey is reused in the same scope", async () => {
    const t = initConvexTest();
    const first = await t.mutation(api.mutations.track, {
      scope: "s", name: "e", dedupeKey: "k1", ts: DAY,
      dimensions: [], granularities: ["day"],
    });
    expect(first).toBe("tracked");
    const second = await t.mutation(api.mutations.track, {
      scope: "s", name: "e", dedupeKey: "k1", ts: DAY,
      dimensions: [], granularities: ["day"],
    });
    expect(second).toBe("duplicate");
    expect(await t.query(api.queries.metric, { scope: "s", name: "e" })).toBe(1);
  });

  it("skips a declared dimension absent from props", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", props: { plan: "pro" }, ts: DAY,
      dimensions: ["plan", "missing"], granularities: ["day"],
    });
    expect(
      await t.query(api.queries.top, { scope: "s", name: "e", dimension: "missing" }),
    ).toEqual([]);
    expect(
      await t.query(api.queries.top, { scope: "s", name: "e", dimension: "plan" }),
    ).toEqual([{ value: "pro", count: 1 }]);
  });

  it("rate-limits per sessionRef once the bucket is exhausted", async () => {
    const t = initConvexTest();
    let dropped = 0;
    for (let i = 0; i < 30; i++) {
      const r = await t.mutation(api.mutations.track, {
        scope: "s", name: "e", sessionRef: "burst", ts: DAY + i,
        dimensions: [], granularities: ["day"],
      });
      if (r === "dropped") dropped++;
    }
    expect(dropped).toBeGreaterThan(0);
  });

  it("rolls up boolean/number/null scalar prop values via valKey", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", props: { ok: true, n: 5, missing: null }, ts: DAY,
      dimensions: ["ok", "n", "missing"], granularities: ["day"],
    });
    expect(await t.query(api.queries.top, { scope: "s", name: "e", dimension: "ok" }))
      .toEqual([{ value: "true", count: 1 }]);
    expect(await t.query(api.queries.top, { scope: "s", name: "e", dimension: "n" }))
      .toEqual([{ value: "5", count: 1 }]);
    expect(await t.query(api.queries.top, { scope: "s", name: "e", dimension: "missing" }))
      .toEqual([{ value: "null", count: 1 }]);
  });
});
