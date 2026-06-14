/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { api, internal } from "../src/component/_generated/api.js";
import { initConvexTest } from "./test-helpers.js";

const D = (day: number) => Date.UTC(2026, 0, day, 10, 0, 0);

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

  it("uses the default retention (90d) and sweeps all configured scopes", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configSet, { scope: "s", key: "x", value: "y" });
    const old = Date.now() - 200 * 86400000;
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", ts: old, dimensions: [], granularities: ["day"],
    });
    const res = await t.mutation(internal.internal_mutations.prune, {});
    expect(res.deleted).toBe(1);
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

  it("uses the default idle timeout across all scopes when scope omitted", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.configSet, { scope: "s", key: "x", value: "y" });
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", sessionRef: "old", ts: Date.now() - 60 * 60 * 1000,
      dimensions: [], granularities: ["day"],
    });
    const res = await t.mutation(internal.internal_mutations.closeSessions, {});
    expect(res.closed).toBe(1);
  });
});

describe("backfill", () => {
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
      scope: "s", name: "e", dimensions: ["plan"], granularities: ["hour", "day"],
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
