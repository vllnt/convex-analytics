/// <reference types="vite/client" />
import { describe, it, expect, vi } from "vitest";
import { api, internal } from "../src/component/_generated/api.js";
import crons from "../src/component/crons.js";
import { guardBackfillSize } from "../src/component/internal_mutations.js";
import { initConvexTest } from "./test-helpers.js";

const D = (day: number) => Date.UTC(2026, 0, day, 10, 0, 0);

describe("cron registration", () => {
  it("registers session closure and event retention maintenance", () => {
    expect(Object.keys(crons.crons)).toEqual([
      "analytics:close-sessions",
      "analytics:prune-events",
    ]);
  });
});

describe("configure / configSet", () => {
  it("persists retention/sampling/idle, inserting then patching", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configure, {
      scope: "s", retentionDays: 30, sampleRate: 0.5, sessionIdleMs: 1000,
    });
    expect(await t.query(api.queries.configGet, { scope: "s", key: "retentionDays" })).toBe("30");
    expect(await t.query(api.queries.configGet, { scope: "s", key: "sampleRate" })).toBe("0.5");
    expect(await t.query(api.queries.configGet, { scope: "s", key: "sessionIdleMs" })).toBe("1000");

    await t.mutation(api.mutations.configure, { scope: "s", retentionDays: 7 });
    expect(await t.query(api.queries.configGet, { scope: "s", key: "retentionDays" })).toBe("7");
  });

  it("writes nothing when configure is called with no fields", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configure, { scope: "empty" });
    const rows = await t.run(async (ctx) =>
      ctx.db.query("config").withIndex("by_scope_key", (q) => q.eq("scope", "empty")).collect(),
    );
    expect(rows).toHaveLength(0);
  });

  it("configSet patches an existing key", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configSet, { scope: "s", key: "k", value: "1" });
    await t.mutation(api.mutations.configSet, { scope: "s", key: "k", value: "2" });
    expect(await t.query(api.queries.configGet, { scope: "s", key: "k" })).toBe("2");
  });
});

describe("prune", () => {
  it("deletes raw events older than retentionDays, keeps rollups", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configure, { scope: "s", retentionDays: 30 });
    const old = Date.now() - 60 * 86400000;
    const fresh = Date.now() - 1000;
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", ts: old, dimensions: [], granularities: ["day"],
    });
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", ts: fresh, dimensions: [], granularities: ["day"],
    });

    const res = await t.mutation(internal.internal_mutations.prune, { scope: "s" });
    expect(res.deleted).toBe(1);

    const page = await t.query(api.queries.list, {
      scope: "s", name: "e", paginationOpts: { numItems: 10, cursor: null },
    });
    expect(page.page).toHaveLength(1);
    expect(page.page[0]!.ts).toBe(fresh);
    expect(await t.query(api.queries.metric, { scope: "s", name: "e" })).toBe(2);
  });

  it("uses the default retention (90d) and discovers zero-config scopes", async () => {
    vi.useFakeTimers();
    try {
      const t = initConvexTest();
      const old = Date.now() - 200 * 86400000;
      await t.mutation(api.mutations.track, {
        scope: "s", name: "e", ts: old, dimensions: [], granularities: ["day"],
      });
      const res = await t.mutation(internal.internal_mutations.prune, {});
      expect(res.deleted).toBe(1);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const page = await t.query(api.queries.list, {
        scope: "s", name: "e", paginationOpts: { numItems: 10, cursor: null },
      });
      expect(page.page).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reschedules a full bounded deletion page", async () => {
    const t = initConvexTest();
    const old = Date.now() - 200 * 86400000;
    await t.run(async (ctx) => {
      await Promise.all(
        Array.from({ length: 500 }, (_, seq) =>
          ctx.db.insert("events", {
            scope: "s", name: "e", props: {}, ts: old, seq,
          }),
        ),
      );
    });
    expect(
      (await t.mutation(internal.internal_mutations.prune, { scope: "s" })).deleted,
    ).toBe(500);
  });

  it("paginates scope discovery instead of collecting the registry", async () => {
    vi.useFakeTimers();
    try {
      const t = initConvexTest();
      await t.run(async (ctx) => {
        await Promise.all(
          Array.from({ length: 101 }, (_, index) =>
            ctx.db.insert("scopes", { scope: `scope-${String(index).padStart(3, "0")}` }),
          ),
        );
      });
      await t.mutation(internal.internal_mutations.prune, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the default when retentionDays is non-numeric, deletes nothing when fresh", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configSet, { scope: "s", key: "retentionDays", value: "nope" });
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", ts: Date.now(), dimensions: [], granularities: ["day"],
    });
    const res = await t.mutation(internal.internal_mutations.prune, { scope: "s" });
    expect(res.deleted).toBe(0);
  });
});

describe("closeSessions", () => {
  it("closes sessions idle past the timeout and leaves active ones open", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configure, { scope: "s", sessionIdleMs: 1000 });
    const old = Date.now() - 60000;
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", sessionRef: "idle", ts: old, dimensions: [], granularities: ["day"],
    });
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", sessionRef: "active", ts: Date.now(), dimensions: [], granularities: ["day"],
    });

    const res = await t.mutation(internal.internal_mutations.closeSessions, { scope: "s" });
    expect(res.closed).toBe(1);

    const idle = await t.run(async (ctx) =>
      ctx.db.query("sessions").withIndex("by_scope_session", (q) =>
        q.eq("scope", "s").eq("sessionRef", "idle"),
      ).unique(),
    );
    expect(idle!.endTs).toBe(old);
  });

  it("reschedules a full bounded session page", async () => {
    const t = initConvexTest();
    const old = Date.now() - 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await Promise.all(
        Array.from({ length: 500 }, (_, index) =>
          ctx.db.insert("sessions", {
            scope: "s", sessionRef: `session-${index}`, startTs: old,
            lastTs: old, eventCount: 1,
          }),
        ),
      );
    });
    expect(
      (await t.mutation(internal.internal_mutations.closeSessions, { scope: "s" })).closed,
    ).toBe(500);
  });

  it("is idempotent — a second run closes nothing more", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configure, { scope: "s", sessionIdleMs: 1 });
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", sessionRef: "x", ts: Date.now() - 100000,
      dimensions: [], granularities: ["day"],
    });
    expect((await t.mutation(internal.internal_mutations.closeSessions, { scope: "s" })).closed).toBe(1);
    expect((await t.mutation(internal.internal_mutations.closeSessions, { scope: "s" })).closed).toBe(0);
  });

  it("paginates scope discovery for session maintenance", async () => {
    vi.useFakeTimers();
    try {
      const t = initConvexTest();
      await t.run(async (ctx) => {
        await Promise.all(
          Array.from({ length: 101 }, (_, index) =>
            ctx.db.insert("scopes", { scope: `scope-${String(index).padStart(3, "0")}` }),
          ),
        );
      });
      await t.mutation(internal.internal_mutations.closeSessions, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the default idle timeout across zero-config scopes when scope omitted", async () => {
    vi.useFakeTimers();
    try {
      const t = initConvexTest();
      await t.mutation(api.mutations.track, {
        scope: "s", name: "e", sessionRef: "old", ts: Date.now() - 60 * 60 * 1000,
        dimensions: [], granularities: ["day"],
      });
      const res = await t.mutation(internal.internal_mutations.closeSessions, {});
      expect(res.closed).toBe(1);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const session = await t.run(async (ctx) =>
        ctx.db.query("sessions").withIndex("by_scope_session", (q) =>
          q.eq("scope", "s").eq("sessionRef", "old"),
        ).unique(),
      );
      expect(session?.endTs).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("batched maintenance sweeps", () => {
  const scheduled = (t: ReturnType<typeof initConvexTest>) =>
    t.run(async (ctx) => (await ctx.db.system.query("_scheduled_functions").collect()).length);

  it("prunes quiet scopes inline without scheduling one job per scope", async () => {
    const t = initConvexTest();
    const old = Date.now() - 200 * 86400000;
    await t.run(async (ctx) => {
      await Promise.all(
        ["a", "b", "c"].flatMap((scope) => [
          ctx.db.insert("scopes", { scope }),
          ctx.db.insert("events", { scope, name: "e", props: {}, ts: old, seq: 0 }),
        ]),
      );
    });
    expect((await t.mutation(internal.internal_mutations.prune, {})).deleted).toBe(3);
    expect(await scheduled(t)).toBe(0);
  });

  it("hands only a busy scope to its own continuation job", async () => {
    vi.useFakeTimers();
    try {
      const t = initConvexTest();
      const old = Date.now() - 200 * 86400000;
      await t.run(async (ctx) => {
        await ctx.db.insert("scopes", { scope: "busy" });
        await ctx.db.insert("scopes", { scope: "quiet" });
        await ctx.db.insert("events", { scope: "quiet", name: "e", props: {}, ts: old, seq: 0 });
        await Promise.all(
          Array.from({ length: 12 }, (_, seq) =>
            ctx.db.insert("events", { scope: "busy", name: "e", props: {}, ts: old, seq }),
          ),
        );
      });
      expect((await t.mutation(internal.internal_mutations.prune, {})).deleted).toBe(6);
      expect(await scheduled(t)).toBe(1);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const left = await t.run(async (ctx) => (await ctx.db.query("events").collect()).length);
      expect(left).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops an inline sweep at the read budget and continues until every scope is drained", async () => {
    vi.useFakeTimers();
    try {
      const t = initConvexTest({ transactionLimits: true });
      const old = Date.now() - 200 * 86400000;
      const blob = "x".repeat(40_000);
      const scopes = Array.from({ length: 100 }, (_, i) => `scope-${String(i).padStart(3, "0")}`);
      for (const scope of scopes) {
        await t.run(async (ctx) => {
          await ctx.db.insert("scopes", { scope });
          await Promise.all(
            Array.from({ length: 4 }, (_, seq) =>
              ctx.db.insert("events", { scope, name: "e", props: { blob }, ts: old, seq }),
            ),
          );
        });
      }
      const first = await t.mutation(internal.internal_mutations.prune, {});
      expect(first.deleted).toBeGreaterThan(0);
      expect(first.deleted).toBeLessThan(400);
      expect(await scheduled(t)).toBe(1);
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const left = await t.run(async (ctx) => (await ctx.db.query("events").collect()).length);
      expect(left).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes idle sessions across quiet scopes inline without per-scope jobs", async () => {
    const t = initConvexTest();
    const idle = Date.now() - 60 * 60 * 1000;
    await t.run(async (ctx) => {
      await Promise.all(
        ["a", "b"].flatMap((scope) => [
          ctx.db.insert("scopes", { scope }),
          ctx.db.insert("sessions", {
            scope, sessionRef: "s1", startTs: idle, lastTs: idle, eventCount: 1,
          }),
        ]),
      );
    });
    expect((await t.mutation(internal.internal_mutations.closeSessions, {})).closed).toBe(2);
    expect(await scheduled(t)).toBe(0);
  });
});

describe("backfill", () => {
  it("fails closed before replacing rollups when the retained input is truncated", () => {
    expect(() => guardBackfillSize(50000)).not.toThrow();
    expect(() => guardBackfillSize(50001)).toThrow(/existing rollups were preserved/);
  });

  it("re-derives rollups from raw events (idempotent, replaces existing)", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", props: { plan: "pro" }, ts: D(1),
      dimensions: [], granularities: ["day"],
    });
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", props: { plan: "pro" }, ts: D(1),
      dimensions: [], granularities: ["day"],
    });
    expect(await t.query(api.queries.top, { scope: "s", name: "e", dimension: "plan" })).toEqual([]);

    const res = await t.mutation(internal.internal_mutations.backfill, {
      scope: "s", name: "e", dimensions: ["plan", "missing"], granularities: ["hour", "day"],
    });
    expect(res.events).toBe(2);
    expect(await t.query(api.queries.top, { scope: "s", name: "e", dimension: "plan" }))
      .toEqual([{ value: "pro", count: 2 }]);

    const again = await t.mutation(internal.internal_mutations.backfill, {
      scope: "s", name: "e", dimensions: ["plan"], granularities: [],
    });
    expect(again.events).toBe(2);
    expect(await t.query(api.queries.top, { scope: "s", name: "e", dimension: "plan" }))
      .toEqual([{ value: "pro", count: 2 }]);
  });
});
