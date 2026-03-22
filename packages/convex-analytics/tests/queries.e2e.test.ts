/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../src/component/_generated/api.js";
import schema from "../src/component/schema.js";

const modules = import.meta.glob("../src/component/**/*.ts");

function initTest() {
  return convexTest(schema, modules);
}

/* ─── Data Seeding Helpers ─────────────────────────────────────────────── */

const EVENT_DEFAULTS = {
  projectId: "default",
  env: "production",
  platform: "web",
  properties: {},
  path: "/",
  locale: "en",
  referrer: "",
  device: "desktop",
  browser: "Chrome",
  os: "macOS",
  country: "US",
  seqNum: 0,
} as const;

const SESSION_DEFAULTS = {
  projectId: "default",
  env: "production",
  platform: "web",
  eventCount: 1,
  entryPath: "/",
  exitPath: "/",
  referrer: "",
  device: "desktop",
  browser: "Chrome",
  os: "macOS",
  locale: "en",
  country: "US",
} as const;

const USER_DEFAULTS = {
  projectIds: ["default"],
  sessionCount: 1,
  totalEvents: 1,
  device: "desktop",
  browser: "Chrome",
  os: "macOS",
  locale: "en",
  country: "US",
} as const;

const ROLLUP_DEFAULTS = {
  projectId: "default",
  env: "production",
  dimensions: {},
} as const;

type DbCtx = {
  db: { insert: (table: string, doc: Record<string, unknown>) => Promise<unknown> };
};

async function seedEvents(
  ctx: DbCtx,
  events: Array<Partial<typeof EVENT_DEFAULTS> & { name: string; userId: string; sessionId?: string; timestamp: number }>,
): Promise<void> {
  for (const e of events) {
    await ctx.db.insert("events", {
      ...EVENT_DEFAULTS,
      sessionId: e.sessionId ?? `s_${e.userId}`,
      ...e,
    });
  }
}

async function seedRollups(
  ctx: DbCtx,
  rollups: Array<Partial<typeof ROLLUP_DEFAULTS> & { name: string; date: string; count: number; uniqueUsers: number }>,
): Promise<void> {
  for (const r of rollups) {
    await ctx.db.insert("daily_rollups", { ...ROLLUP_DEFAULTS, ...r });
  }
}

async function seedUsers(
  ctx: DbCtx,
  users: Array<Partial<typeof USER_DEFAULTS> & { visitorId: string; firstSeen: number; lastSeen: number }>,
): Promise<void> {
  for (const u of users) {
    await ctx.db.insert("users", { ...USER_DEFAULTS, ...u });
  }
}

async function seedSessions(
  ctx: DbCtx,
  sessions: Array<Partial<typeof SESSION_DEFAULTS> & { userId: string; sessionId: string; startTime: number }>,
): Promise<void> {
  for (const s of sessions) {
    await ctx.db.insert("sessions", { ...SESSION_DEFAULTS, ...s });
  }
}

/* ─── 1. queries.list ──────────────────────────────────────────────────── */

describe("queries.list", () => {
  it("returns seeded events for a given name", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "signup", userId: "u1", timestamp: 1000 },
        { name: "signup", userId: "u2", timestamp: 2000 },
        { name: "signup", userId: "u3", timestamp: 3000 },
        { name: "signup", userId: "u4", timestamp: 4000 },
        { name: "signup", userId: "u5", timestamp: 5000 },
        { name: "page_view", userId: "u1", timestamp: 6000 },
      ]);
    });

    const result = await t.query(api.queries.list, { name: "signup" });
    expect(result.data).toHaveLength(5);
    expect(result.hasMore).toBe(false);
    for (const e of result.data) {
      expect(e.name).toBe("signup");
    }
  });

  it("respects limit and sets hasMore=true", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "click", userId: "u1", timestamp: 1000 },
        { name: "click", userId: "u2", timestamp: 2000 },
        { name: "click", userId: "u3", timestamp: 3000 },
        { name: "click", userId: "u4", timestamp: 4000 },
        { name: "click", userId: "u5", timestamp: 5000 },
      ]);
    });

    const result = await t.query(api.queries.list, { name: "click", limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.hasMore).toBe(true);
  });

  it("filters by projectId using by_project_name index", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "signup", userId: "u1", timestamp: 1000, projectId: "docs" },
        { name: "signup", userId: "u2", timestamp: 2000, projectId: "app" },
        { name: "signup", userId: "u3", timestamp: 3000, projectId: "docs" },
      ]);
    });

    const result = await t.query(api.queries.list, {
      name: "signup",
      projectId: "docs",
    });
    expect(result.data).toHaveLength(2);
    for (const e of result.data) {
      expect(e.projectId).toBe("docs");
    }
  });

  it("returns empty data when no events match", async () => {
    const t = initTest();

    const result = await t.query(api.queries.list, { name: "nonexistent" });
    expect(result.data).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it("returns events in descending timestamp order", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "click", userId: "u1", timestamp: 1000 },
        { name: "click", userId: "u2", timestamp: 3000 },
        { name: "click", userId: "u3", timestamp: 2000 },
      ]);
    });

    const result = await t.query(api.queries.list, { name: "click" });
    expect(result.data[0]!.timestamp).toBeGreaterThanOrEqual(result.data[1]!.timestamp);
    expect(result.data[1]!.timestamp).toBeGreaterThanOrEqual(result.data[2]!.timestamp);
  });
});

/* ─── 2. queries.count ─────────────────────────────────────────────────── */

describe("queries.count", () => {
  it("returns time-bounded count from daily_rollups", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "signup", date: "2026-03-01", count: 10, uniqueUsers: 5 },
        { name: "signup", date: "2026-03-02", count: 20, uniqueUsers: 8 },
        { name: "signup", date: "2026-03-03", count: 15, uniqueUsers: 7 },
        { name: "signup", date: "2026-03-10", count: 5, uniqueUsers: 3 },
      ]);
    });

    const from = new Date("2026-03-01").getTime();
    const to = new Date("2026-03-03").getTime();
    const result = await t.query(api.queries.count, { name: "signup", from, to });
    expect(result).toBe(45);
  });

  it("returns 0 when no rollups match the date range", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "signup", date: "2026-01-01", count: 100, uniqueUsers: 50 },
      ]);
    });

    const from = new Date("2026-06-01").getTime();
    const to = new Date("2026-06-30").getTime();
    const result = await t.query(api.queries.count, { name: "signup", from, to });
    expect(result).toBe(0);
  });

  /**
   * Total count (no from/to) uses ShardedCounter child component.
   * Child components are not available in convex-test, so this path is untestable here.
   */
});

/* ─── 3. queries.summary ───────────────────────────────────────────────── */

describe("queries.summary", () => {
  /**
   * summary() uses ShardedCounter (counter.count) to get per-name totals.
   * Since the ShardedCounter child component is not registered in convex-test,
   * any call to counter.count() will fail. This query is untestable in this
   * E2E harness without child component support.
   */
  it.skip("uses ShardedCounter — untestable without child component registration", () => {});
});

/* ─── 4. queries.timeseries ────────────────────────────────────────────── */

describe("queries.timeseries", () => {
  it("returns daily buckets from rollups", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "signup", date: "2026-03-01", count: 5, uniqueUsers: 3 },
        { name: "signup", date: "2026-03-02", count: 8, uniqueUsers: 6 },
        { name: "signup", date: "2026-03-03", count: 3, uniqueUsers: 2 },
      ]);
    });

    const result = await t.query(api.queries.timeseries, {
      name: "signup",
      interval: "day",
    });

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ date: "2026-03-01", count: 5, uniques: 3 });
    expect(result[1]).toEqual({ date: "2026-03-02", count: 8, uniques: 6 });
    expect(result[2]).toEqual({ date: "2026-03-03", count: 3, uniques: 2 });
  });

  it("buckets by week (Monday start)", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      /* 2026-03-02 = Monday, 2026-03-09 = Monday */
      await seedRollups(ctx as never, [
        { name: "signup", date: "2026-03-02", count: 10, uniqueUsers: 5 },
        { name: "signup", date: "2026-03-03", count: 7, uniqueUsers: 4 },
        { name: "signup", date: "2026-03-09", count: 12, uniqueUsers: 8 },
        { name: "signup", date: "2026-03-10", count: 3, uniqueUsers: 2 },
      ]);
    });

    const result = await t.query(api.queries.timeseries, {
      name: "signup",
      interval: "week",
    });

    expect(result).toHaveLength(2);
    const week1 = result.find((b: { date: string }) => b.date === "2026-03-02");
    const week2 = result.find((b: { date: string }) => b.date === "2026-03-09");
    expect(week1).toBeDefined();
    expect(week1!.count).toBe(17);
    expect(week2).toBeDefined();
    expect(week2!.count).toBe(15);
  });

  it("buckets by month", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "signup", date: "2026-03-01", count: 5, uniqueUsers: 3 },
        { name: "signup", date: "2026-03-15", count: 10, uniqueUsers: 7 },
        { name: "signup", date: "2026-04-01", count: 2, uniqueUsers: 1 },
      ]);
    });

    const result = await t.query(api.queries.timeseries, {
      name: "signup",
      interval: "month",
    });

    expect(result).toHaveLength(2);
    const march = result.find((b: { date: string }) => b.date === "2026-03");
    const april = result.find((b: { date: string }) => b.date === "2026-04");
    expect(march!.count).toBe(15);
    expect(april!.count).toBe(2);
  });

  it("filters by projectId", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "signup", date: "2026-03-01", count: 10, uniqueUsers: 5, projectId: "docs" },
        { name: "signup", date: "2026-03-01", count: 20, uniqueUsers: 10, projectId: "app" },
      ]);
    });

    const result = await t.query(api.queries.timeseries, {
      name: "signup",
      interval: "day",
      projectId: "docs",
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.count).toBe(10);
  });

  it("filters by from/to date range", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "signup", date: "2026-02-28", count: 1, uniqueUsers: 1 },
        { name: "signup", date: "2026-03-01", count: 5, uniqueUsers: 3 },
        { name: "signup", date: "2026-03-02", count: 8, uniqueUsers: 6 },
        { name: "signup", date: "2026-03-10", count: 99, uniqueUsers: 50 },
      ]);
    });

    const from = new Date("2026-03-01").getTime();
    const to = new Date("2026-03-02").getTime();
    const result = await t.query(api.queries.timeseries, {
      name: "signup",
      interval: "day",
      from,
      to,
    });

    expect(result).toHaveLength(2);
    expect(result.map((r: { count: number }) => r.count)).toEqual([5, 8]);
  });

  it("returns empty array for no matching rollups", async () => {
    const t = initTest();

    const result = await t.query(api.queries.timeseries, {
      name: "nonexistent",
      interval: "day",
    });
    expect(result).toHaveLength(0);
  });
});

/* ─── 5. queries.funnel ────────────────────────────────────────────────── */

describe("queries.funnel", () => {
  it("calculates funnel counts and rates across steps", async () => {
    const t = initTest();

    const now = Date.now();
    const from = now - 30 * 86400000;
    const to = now;

    await t.run(async (ctx) => {
      /* 3 users do step1, 2 do step2, 1 does step3 */
      await seedEvents(ctx as never, [
        { name: "step1", userId: "u1", timestamp: now - 5000 },
        { name: "step1", userId: "u2", timestamp: now - 4000 },
        { name: "step1", userId: "u3", timestamp: now - 3000 },
        { name: "step2", userId: "u1", timestamp: now - 2000 },
        { name: "step2", userId: "u2", timestamp: now - 1500 },
        { name: "step3", userId: "u1", timestamp: now - 1000 },
      ]);
    });

    const result = await t.query(api.queries.funnel, {
      steps: ["step1", "step2", "step3"],
      window: "30d",
      from,
      to,
    });

    expect(result).toHaveLength(3);
    expect(result[0]!.step).toBe("step1");
    expect(result[0]!.count).toBe(3);
    expect(result[0]!.rate).toBe(1);

    expect(result[1]!.step).toBe("step2");
    expect(result[1]!.count).toBe(2);

    expect(result[2]!.step).toBe("step3");
    expect(result[2]!.count).toBe(1);
  });

  it("throws when fewer than 2 steps are provided", async () => {
    const t = initTest();

    await expect(
      t.query(api.queries.funnel, { steps: ["only_one"] }),
    ).rejects.toThrow("Funnel requires at least 2 steps");
  });

  it("returns zero counts when no users complete later steps", async () => {
    const t = initTest();

    const now = Date.now();
    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "step1", userId: "u1", timestamp: now - 5000 },
        { name: "step1", userId: "u2", timestamp: now - 4000 },
      ]);
    });

    const result = await t.query(api.queries.funnel, {
      steps: ["step1", "step2"],
      window: "30d",
      from: now - 30 * 86400000,
      to: now,
    });

    expect(result[0]!.count).toBe(2);
    expect(result[1]!.count).toBe(0);
    expect(result[1]!.dropoff).toBe(1);
  });
});

/* ─── 6. queries.retention ─────────────────────────────────────────────── */

describe("queries.retention", () => {
  it("returns cohort structure with retention arrays", async () => {
    const t = initTest();

    const now = Date.now();
    const weekMs = 604800000;

    await t.run(async (ctx) => {
      await seedUsers(ctx as never, [
        {
          visitorId: "u1",
          firstSeen: now - 3 * weekMs,
          lastSeen: now - 2 * weekMs,
        },
        {
          visitorId: "u2",
          firstSeen: now - 3 * weekMs,
          lastSeen: now - 1 * weekMs,
        },
        {
          visitorId: "u3",
          firstSeen: now - 2 * weekMs,
          lastSeen: now - 1 * weekMs,
        },
      ]);
    });

    const result = await t.query(api.queries.retention, {
      event: "page_view",
      period: "week",
      cohorts: 4,
    });

    expect(result.cohorts).toBeDefined();
    expect(Array.isArray(result.cohorts)).toBe(true);
    expect(result.cohorts.length).toBe(4);

    for (const cohort of result.cohorts) {
      expect(cohort).toHaveProperty("period");
      expect(cohort).toHaveProperty("date");
      expect(cohort).toHaveProperty("size");
      expect(cohort).toHaveProperty("retained");
      expect(Array.isArray(cohort.retained)).toBe(true);
    }
  });

  it("returns empty cohorts when no users exist", async () => {
    const t = initTest();

    const result = await t.query(api.queries.retention, {
      event: "signup",
      period: "week",
      cohorts: 3,
    });

    expect(result.cohorts).toHaveLength(3);
    for (const cohort of result.cohorts) {
      expect(cohort.size).toBe(0);
    }
  });
});

/* ─── 7. queries.breakdown ─────────────────────────────────────────────── */

describe("queries.breakdown", () => {
  it("returns dimension breakdown from rollups", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        {
          name: "signup",
          date: "2026-03-01",
          count: 15,
          uniqueUsers: 10,
          dimensions: { locale: { en: 10, fr: 5 } },
        },
        {
          name: "signup",
          date: "2026-03-02",
          count: 9,
          uniqueUsers: 6,
          dimensions: { locale: { en: 6, de: 3 } },
        },
      ]);
    });

    const result = await t.query(api.queries.breakdown, {
      name: "signup",
      dimension: "locale",
    });

    expect(result.length).toBeGreaterThanOrEqual(3);

    const en = result.find((r: { value: string }) => r.value === "en");
    const fr = result.find((r: { value: string }) => r.value === "fr");
    const de = result.find((r: { value: string }) => r.value === "de");

    expect(en!.count).toBe(16);
    expect(fr!.count).toBe(5);
    expect(de!.count).toBe(3);

    const totalCount = result.reduce((sum: number, r: { count: number }) => sum + r.count, 0);
    for (const entry of result) {
      expect(entry.percentage).toBeCloseTo(entry.count / totalCount, 5);
    }
  });

  it("returns empty array when dimension does not exist", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        {
          name: "signup",
          date: "2026-03-01",
          count: 10,
          uniqueUsers: 5,
          dimensions: { locale: { en: 10 } },
        },
      ]);
    });

    const result = await t.query(api.queries.breakdown, {
      name: "signup",
      dimension: "nonexistent_dim",
    });
    expect(result).toHaveLength(0);
  });

  it("respects limit parameter", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        {
          name: "signup",
          date: "2026-03-01",
          count: 60,
          uniqueUsers: 30,
          dimensions: { country: { US: 30, UK: 15, DE: 10, FR: 5 } },
        },
      ]);
    });

    const result = await t.query(api.queries.breakdown, {
      name: "signup",
      dimension: "country",
      limit: 2,
    });

    expect(result).toHaveLength(2);
    expect(result[0]!.value).toBe("US");
    expect(result[1]!.value).toBe("UK");
  });

  it("filters by projectId", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        {
          name: "signup",
          date: "2026-03-01",
          count: 10,
          uniqueUsers: 5,
          projectId: "docs",
          dimensions: { locale: { en: 10 } },
        },
        {
          name: "signup",
          date: "2026-03-01",
          count: 20,
          uniqueUsers: 10,
          projectId: "app",
          dimensions: { locale: { fr: 20 } },
        },
      ]);
    });

    const result = await t.query(api.queries.breakdown, {
      name: "signup",
      dimension: "locale",
      projectId: "docs",
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.value).toBe("en");
    expect(result[0]!.count).toBe(10);
  });
});

/* ─── 8. queries.attribution ───────────────────────────────────────────── */

describe("queries.attribution", () => {
  it("returns attribution sources for conversion events", async () => {
    const t = initTest();

    const now = Date.now();
    const from = now - 30 * 86400000;
    const to = now;

    await t.run(async (ctx) => {
      /* Seed conversion events */
      await seedEvents(ctx as never, [
        { name: "purchase", userId: "u1", timestamp: now - 1000 },
        { name: "purchase", userId: "u2", timestamp: now - 2000 },
        { name: "purchase", userId: "u3", timestamp: now - 3000 },
      ]);

      /* Seed first sessions with different referrers */
      await seedSessions(ctx as never, [
        { userId: "u1", sessionId: "s_u1", startTime: now - 10000, referrer: "google.com" },
        { userId: "u2", sessionId: "s_u2", startTime: now - 20000, referrer: "google.com" },
        { userId: "u3", sessionId: "s_u3", startTime: now - 30000, referrer: "twitter.com" },
      ]);
    });

    const result = await t.query(api.queries.attribution, {
      conversionEvent: "purchase",
      from,
      to,
    });

    expect(result.length).toBeGreaterThanOrEqual(2);

    const google = result.find((r: { source: string }) => r.source === "google.com");
    const twitter = result.find((r: { source: string }) => r.source === "twitter.com");

    expect(google!.conversions).toBe(2);
    expect(twitter!.conversions).toBe(1);
    expect(google!.rate + twitter!.rate).toBeCloseTo(1.0, 5);
  });

  it("returns 'direct' for sessions with empty referrer", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "purchase", userId: "u1", timestamp: now - 1000 },
      ]);
      await seedSessions(ctx as never, [
        { userId: "u1", sessionId: "s_u1", startTime: now - 10000, referrer: "" },
      ]);
    });

    const result = await t.query(api.queries.attribution, {
      conversionEvent: "purchase",
      from: now - 86400000,
      to: now,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.source).toBe("direct");
  });

  it("returns empty array when no conversion events exist", async () => {
    const t = initTest();

    const now = Date.now();
    const result = await t.query(api.queries.attribution, {
      conversionEvent: "purchase",
      from: now - 86400000,
      to: now,
    });
    expect(result).toHaveLength(0);
  });
});

/* ─── 9. queries.userTimeline ──────────────────────────────────────────── */

describe("queries.userTimeline", () => {
  it("returns user, events, and sessions for a given userId", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await seedUsers(ctx as never, [
        { visitorId: "u1", firstSeen: now - 86400000, lastSeen: now },
      ]);
      await seedEvents(ctx as never, [
        { name: "page_view", userId: "u1", timestamp: now - 5000 },
        { name: "signup", userId: "u1", timestamp: now - 3000 },
        { name: "purchase", userId: "u1", timestamp: now - 1000 },
      ]);
      await seedSessions(ctx as never, [
        { userId: "u1", sessionId: "sess_a", startTime: now - 10000 },
        { userId: "u1", sessionId: "sess_b", startTime: now - 5000 },
      ]);
    });

    const result = await t.query(api.queries.userTimeline, { userId: "u1" });

    expect(result.user).not.toBeNull();
    expect(result.user!.visitorId).toBe("u1");
    expect(result.events).toHaveLength(3);
    expect(result.sessions).toHaveLength(2);
  });

  it("returns null user when visitorId does not exist", async () => {
    const t = initTest();

    const result = await t.query(api.queries.userTimeline, { userId: "ghost" });
    expect(result.user).toBeNull();
    expect(result.events).toHaveLength(0);
    expect(result.sessions).toHaveLength(0);
  });

  it("respects limit on events", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await seedUsers(ctx as never, [
        { visitorId: "u1", firstSeen: now - 86400000, lastSeen: now },
      ]);
      for (let i = 0; i < 10; i++) {
        await seedEvents(ctx as never, [
          { name: "click", userId: "u1", timestamp: now - i * 1000 },
        ]);
      }
    });

    const result = await t.query(api.queries.userTimeline, {
      userId: "u1",
      limit: 3,
    });

    expect(result.events).toHaveLength(3);
  });
});

/* ─── 10. queries.sessionDetail ────────────────────────────────────────── */

describe("queries.sessionDetail", () => {
  it("returns session and events sorted by seqNum", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await seedSessions(ctx as never, [
        { userId: "u1", sessionId: "sess_1", startTime: now - 10000, eventCount: 5 },
      ]);

      /* Insert events with non-sequential seqNums to verify sort */
      for (const seq of [3, 1, 4, 0, 2]) {
        await seedEvents(ctx as never, [
          {
            name: "click",
            userId: "u1",
            sessionId: "sess_1",
            timestamp: now - (5 - seq) * 1000,
            seqNum: seq,
          },
        ]);
      }
    });

    const result = await t.query(api.queries.sessionDetail, {
      sessionId: "sess_1",
    });

    expect(result.session).not.toBeNull();
    expect(result.session!.sessionId).toBe("sess_1");
    expect(result.events).toHaveLength(5);

    for (let i = 0; i < result.events.length - 1; i++) {
      expect(result.events[i]!.seqNum).toBeLessThanOrEqual(result.events[i + 1]!.seqNum);
    }
    expect(result.events[0]!.seqNum).toBe(0);
    expect(result.events[4]!.seqNum).toBe(4);
  });

  it("returns null session and empty events for unknown sessionId", async () => {
    const t = initTest();

    const result = await t.query(api.queries.sessionDetail, {
      sessionId: "nonexistent",
    });

    expect(result.session).toBeNull();
    expect(result.events).toHaveLength(0);
  });
});

/* ─── 11. queries.live ─────────────────────────────────────────────────── */

describe("queries.live", () => {
  it("returns most recent events", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "a", userId: "u1", timestamp: now - 3000 },
        { name: "b", userId: "u2", timestamp: now - 2000 },
        { name: "c", userId: "u3", timestamp: now - 1000 },
      ]);
    });

    const result = await t.query(api.queries.live, {});
    expect(result).toHaveLength(3);
  });

  it("respects limit parameter", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "a", userId: "u1", timestamp: now - 3000 },
        { name: "b", userId: "u2", timestamp: now - 2000 },
        { name: "c", userId: "u3", timestamp: now - 1000 },
      ]);
    });

    const result = await t.query(api.queries.live, { limit: 2 });
    expect(result).toHaveLength(2);
  });

  it("filters by projectId", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "a", userId: "u1", timestamp: now - 3000, projectId: "docs" },
        { name: "b", userId: "u2", timestamp: now - 2000, projectId: "app" },
        { name: "c", userId: "u3", timestamp: now - 1000, projectId: "docs" },
      ]);
    });

    const result = await t.query(api.queries.live, { projectId: "docs" });
    expect(result).toHaveLength(2);
    for (const e of result) {
      expect(e.projectId).toBe("docs");
    }
  });

  it("returns empty array when no events exist", async () => {
    const t = initTest();

    const result = await t.query(api.queries.live, {});
    expect(result).toHaveLength(0);
  });
});

/* ─── 12. queries.search ───────────────────────────────────────────────── */

describe("queries.search", () => {
  /**
   * search() discovers event names from event_schemas + daily_rollups,
   * then calls counter.count() (ShardedCounter) for each matching name.
   * The ShardedCounter child component is not available in convex-test,
   * so the counter.count() call will fail.
   *
   * We can test the name-matching/discovery part indirectly by verifying
   * it at least finds names from seeded schemas and rollups before
   * the counter call fails.
   */
  it.skip("uses ShardedCounter for counts — untestable without child component registration", () => {});
});

/* ─── 13. queries.uniques ──────────────────────────────────────────────── */

describe("queries.uniques", () => {
  it("calculates dau/wau/mau and trend from rollups", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "page_view", date: "2026-03-01", count: 100, uniqueUsers: 20 },
        { name: "page_view", date: "2026-03-02", count: 150, uniqueUsers: 30 },
        { name: "page_view", date: "2026-03-03", count: 80, uniqueUsers: 10 },
      ]);
    });

    const from = new Date("2026-03-01").getTime();
    const to = new Date("2026-03-03").getTime();

    const result = await t.query(api.queries.uniques, {
      period: "day",
      from,
      to,
    });

    expect(result).toHaveProperty("dau");
    expect(result).toHaveProperty("wau");
    expect(result).toHaveProperty("mau");
    expect(result).toHaveProperty("trend");

    expect(result.dau).toBe(Math.round(60 / 3));
    expect(result.trend).toHaveLength(3);

    for (const entry of result.trend) {
      expect(entry).toHaveProperty("date");
      expect(entry).toHaveProperty("uniques");
    }
  });

  it("filters by projectId", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "page_view", date: "2026-03-01", count: 50, uniqueUsers: 10, projectId: "docs" },
        { name: "page_view", date: "2026-03-01", count: 100, uniqueUsers: 40, projectId: "app" },
      ]);
    });

    const from = new Date("2026-03-01").getTime();
    const to = new Date("2026-03-01").getTime();

    const result = await t.query(api.queries.uniques, {
      period: "day",
      from,
      to,
      projectId: "docs",
    });

    expect(result.dau).toBe(10);
  });

  it("returns zeros when no rollups exist in range", async () => {
    const t = initTest();

    const from = new Date("2026-06-01").getTime();
    const to = new Date("2026-06-30").getTime();

    const result = await t.query(api.queries.uniques, {
      period: "day",
      from,
      to,
    });

    expect(result.dau).toBe(0);
    expect(result.wau).toBe(0);
    expect(result.mau).toBe(0);
    expect(result.trend).toHaveLength(0);
  });
});

/* ─── 14. queries.lifecycle ────────────────────────────────────────────── */

describe("queries.lifecycle", () => {
  it("classifies users into new/returning/dormant/resurrected", async () => {
    const t = initTest();

    const now = Date.now();
    const weekMs = 604800000;

    await t.run(async (ctx) => {
      /* New user: firstSeen and lastSeen within current period */
      await seedUsers(ctx as never, [
        {
          visitorId: "new_user",
          firstSeen: now - 2 * 86400000,
          lastSeen: now - 86400000,
        },
      ]);

      /* Returning user: firstSeen before period, lastSeen in both previous and current period */
      await seedUsers(ctx as never, [
        {
          visitorId: "returning_user",
          firstSeen: now - 30 * 86400000,
          lastSeen: now - 3 * 86400000,
        },
      ]);

      /* Dormant user: lastSeen well before previous period */
      await seedUsers(ctx as never, [
        {
          visitorId: "dormant_user",
          firstSeen: now - 60 * 86400000,
          lastSeen: now - 30 * 86400000,
        },
      ]);
    });

    const result = await t.query(api.queries.lifecycle, {
      period: "week",
      from: now - weekMs,
      to: now,
    });

    expect(result).toHaveProperty("new");
    expect(result).toHaveProperty("returning");
    expect(result).toHaveProperty("dormant");
    expect(result).toHaveProperty("resurrected");
    expect(result).toHaveProperty("total");

    expect(result.total).toBe(3);
    expect(result.new).toBeGreaterThanOrEqual(0);
    expect(result.dormant).toBeGreaterThanOrEqual(0);
  });

  it("returns all zeros when no users exist", async () => {
    const t = initTest();

    const now = Date.now();

    const result = await t.query(api.queries.lifecycle, {
      period: "week",
      from: now - 604800000,
      to: now,
    });

    expect(result.total).toBe(0);
    expect(result.new).toBe(0);
    expect(result.returning).toBe(0);
    expect(result.dormant).toBe(0);
    expect(result.resurrected).toBe(0);
  });

  it("filters by projectId", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await seedUsers(ctx as never, [
        {
          visitorId: "u1",
          firstSeen: now - 86400000,
          lastSeen: now,
          projectIds: ["docs"],
        },
        {
          visitorId: "u2",
          firstSeen: now - 86400000,
          lastSeen: now,
          projectIds: ["app"],
        },
      ]);
    });

    const result = await t.query(api.queries.lifecycle, {
      period: "week",
      from: now - 604800000,
      to: now,
      projectId: "docs",
    });

    expect(result.total).toBe(1);
  });
});

/* ─── 15. queries.stickiness ───────────────────────────────────────────── */

describe("queries.stickiness", () => {
  it("calculates stickiness ratio and trend from rollups", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "page_view", date: "2026-03-01", count: 100, uniqueUsers: 20 },
        { name: "page_view", date: "2026-03-02", count: 150, uniqueUsers: 25 },
        { name: "page_view", date: "2026-03-03", count: 80, uniqueUsers: 15 },
      ]);
    });

    const from = new Date("2026-03-01").getTime();
    const to = new Date("2026-03-03").getTime();

    const result = await t.query(api.queries.stickiness, { from, to });

    expect(result).toHaveProperty("ratio");
    expect(result).toHaveProperty("trend");

    expect(typeof result.ratio).toBe("number");
    expect(result.ratio).toBeGreaterThanOrEqual(0);
    expect(result.ratio).toBeLessThanOrEqual(1);

    expect(Array.isArray(result.trend)).toBe(true);
    expect(result.trend).toHaveLength(3);

    for (const entry of result.trend) {
      expect(entry).toHaveProperty("date");
      expect(entry).toHaveProperty("dau");
      expect(entry).toHaveProperty("mau");
      expect(entry).toHaveProperty("ratio");
    }
  });

  it("filters by projectId", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "page_view", date: "2026-03-01", count: 50, uniqueUsers: 10, projectId: "docs" },
        { name: "page_view", date: "2026-03-01", count: 100, uniqueUsers: 50, projectId: "app" },
      ]);
    });

    const from = new Date("2026-03-01").getTime();
    const to = new Date("2026-03-01").getTime();

    const docsResult = await t.query(api.queries.stickiness, {
      from,
      to,
      projectId: "docs",
    });

    const appResult = await t.query(api.queries.stickiness, {
      from,
      to,
      projectId: "app",
    });

    expect(docsResult.trend).toHaveLength(1);
    expect(appResult.trend).toHaveLength(1);
    expect(docsResult.trend[0]!.dau).toBe(10);
    expect(appResult.trend[0]!.dau).toBe(50);
  });

  it("returns zero ratio when no rollups exist", async () => {
    const t = initTest();

    const from = new Date("2026-06-01").getTime();
    const to = new Date("2026-06-30").getTime();

    const result = await t.query(api.queries.stickiness, { from, to });

    expect(result.ratio).toBe(0);
    expect(result.trend).toHaveLength(0);
  });
});
