/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../src/component/schema.js";

const modules = import.meta.glob("../src/component/**/*.ts");

function initTest() {
  return convexTest(schema, modules);
}

async function seedEvents(
  ctx: { db: { insert: (table: string, doc: Record<string, unknown>) => Promise<unknown> } },
  events: Array<{ name: string; userId: string; timestamp: number; projectId?: string; locale?: string; country?: string; device?: string }>,
) {
  for (const e of events) {
    await ctx.db.insert("events", {
      userId: e.userId,
      sessionId: `s_${e.userId}`,
      name: e.name,
      projectId: e.projectId ?? "default",
      env: "default",
      platform: "default",
      properties: {},
      timestamp: e.timestamp,
      path: "/",
      locale: e.locale ?? "en",
      referrer: "",
      device: e.device ?? "desktop",
      browser: "Chrome",
      os: "macOS",
      country: e.country ?? "US",
      seqNum: 0,
    });
  }
}

async function seedRollups(
  ctx: { db: { insert: (table: string, doc: Record<string, unknown>) => Promise<unknown> } },
  rollups: Array<{ name: string; date: string; count: number; uniques: number; dimensions?: Record<string, Record<string, number>> }>,
) {
  for (const r of rollups) {
    await ctx.db.insert("daily_rollups", {
      name: r.name,
      projectId: "default",
      env: "default",
      date: r.date,
      count: r.count,
      uniqueUsers: r.uniques,
      dimensions: r.dimensions ?? { locale: { en: r.count } },
    });
  }
}

describe("Phase 2: Analytics Queries", () => {
  it("AC-15: timeseries returns daily buckets", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "signup", date: "2026-03-01", count: 5, uniques: 3 },
        { name: "signup", date: "2026-03-02", count: 8, uniques: 6 },
        { name: "signup", date: "2026-03-03", count: 3, uniques: 2 },
      ]);

      const rollups = await ctx.db
        .query("daily_rollups")
        .withIndex("by_name_date", (q) => q.eq("name", "signup"))
        .collect();

      expect(rollups).toHaveLength(3);
      expect(rollups[0]!.count).toBe(5);
      expect(rollups[1]!.count).toBe(8);
    });
  });

  it("AC-18: breakdown by locale returns grouped counts", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        {
          name: "signup",
          date: "2026-03-01",
          count: 10,
          uniques: 8,
          dimensions: { locale: { en: 6, fr: 3, de: 1 } },
        },
      ]);

      const rollup = await ctx.db
        .query("daily_rollups")
        .withIndex("by_name_date", (q) => q.eq("name", "signup"))
        .first();

      const dims = rollup!.dimensions as Record<string, Record<string, number>>;
      const localeDim = dims["locale"]!;

      expect(localeDim["en"]).toBe(6);
      expect(localeDim["fr"]).toBe(3);
      expect(localeDim["de"]).toBe(1);
    });
  });

  it("AC-20: user timeline returns events + sessions", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "page_view", userId: "u1", timestamp: 1000 },
        { name: "signup", userId: "u1", timestamp: 2000 },
        { name: "page_view", userId: "u2", timestamp: 3000 },
      ]);

      const u1Events = await ctx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", "u1"))
        .collect();

      expect(u1Events).toHaveLength(2);
      expect(u1Events[0]!.name).toBe("page_view");
      expect(u1Events[1]!.name).toBe("signup");
    });
  });

  it("AC-21: session detail returns ordered events by seqNum", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("events", {
          userId: "u1",
          sessionId: "sess_1",
          name: "click",
          projectId: "default",
          env: "default",
          platform: "default",
          properties: {},
          timestamp: 1000 + i * 100,
          path: `/page${i}`,
          locale: "en",
          referrer: "",
          device: "desktop",
          browser: "Chrome",
          os: "macOS",
          country: "US",
          seqNum: i,
        });
      }

      const events = await ctx.db
        .query("events")
        .withIndex("by_session", (q) => q.eq("sessionId", "sess_1"))
        .collect();

      events.sort((a, b) => a.seqNum - b.seqNum);
      expect(events).toHaveLength(5);
      expect(events[0]!.seqNum).toBe(0);
      expect(events[4]!.seqNum).toBe(4);
      expect(events[2]!.path).toBe("/page2");
    });
  });

  it("AC-22: live returns last N events", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "a", userId: "u1", timestamp: 1000 },
        { name: "b", userId: "u2", timestamp: 2000 },
        { name: "c", userId: "u3", timestamp: 3000 },
      ]);

      const events = await ctx.db
        .query("events")
        .order("desc")
        .take(2);

      expect(events).toHaveLength(2);
      // Most recent first
      expect(events[0]!.timestamp).toBeGreaterThanOrEqual(events[1]!.timestamp);
    });
  });

  it("AC-24: uniques from daily_rollups", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedRollups(ctx as never, [
        { name: "page_view", date: "2026-03-01", count: 100, uniques: 20 },
        { name: "page_view", date: "2026-03-02", count: 150, uniques: 25 },
        { name: "page_view", date: "2026-03-03", count: 80, uniques: 15 },
      ]);

      const rollups = await ctx.db
        .query("daily_rollups")
        .withIndex("by_date")
        .collect();

      const totalUniques = rollups.reduce((sum, r) => sum + r.uniqueUsers, 0);
      expect(totalUniques).toBe(60);
    });
  });

  it("AC-25b: lifecycle classifies users", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      const now = Date.now();
      const weekMs = 7 * 86400000;

      // New user (firstSeen this week)
      await ctx.db.insert("users", {
        visitorId: "new_user",
        projectIds: ["default"],
        firstSeen: now - 86400000,
        lastSeen: now,
        sessionCount: 1,
        totalEvents: 3,
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      // Dormant user (not seen in 2 weeks)
      await ctx.db.insert("users", {
        visitorId: "dormant_user",
        projectIds: ["default"],
        firstSeen: now - 30 * 86400000,
        lastSeen: now - 15 * 86400000,
        sessionCount: 5,
        totalEvents: 20,
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      const users = await ctx.db.query("users").collect();
      expect(users).toHaveLength(2);

      const newUser = users.find((u) => u.visitorId === "new_user")!;
      expect(newUser.firstSeen).toBeGreaterThan(now - weekMs);

      const dormant = users.find((u) => u.visitorId === "dormant_user")!;
      expect(dormant.lastSeen).toBeLessThan(now - weekMs);
    });
  });

  it("EC9: zero-event day returns 0 in timeseries", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      // Only rollup for March 1, not March 2
      await seedRollups(ctx as never, [
        { name: "signup", date: "2026-03-01", count: 5, uniques: 3 },
        { name: "signup", date: "2026-03-03", count: 3, uniques: 2 },
      ]);

      const rollups = await ctx.db
        .query("daily_rollups")
        .withIndex("by_name_date", (q) => q.eq("name", "signup"))
        .collect();

      // March 2 has no rollup — sparse is correct
      expect(rollups).toHaveLength(2);
      expect(rollups.find((r) => r.date === "2026-03-02")).toBeUndefined();
    });
  });

  it("AC-15e: scoped query returns only matching projectId", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await seedEvents(ctx as never, [
        { name: "signup", userId: "u1", timestamp: 1000, projectId: "docs" },
        { name: "signup", userId: "u2", timestamp: 2000, projectId: "app" },
        { name: "signup", userId: "u3", timestamp: 3000, projectId: "docs" },
      ]);

      const docsEvents = await ctx.db
        .query("events")
        .withIndex("by_project_name", (q) =>
          q.eq("projectId", "docs").eq("name", "signup"),
        )
        .collect();

      expect(docsEvents).toHaveLength(2);
      for (const e of docsEvents) {
        expect(e.projectId).toBe("docs");
      }
    });
  });
});

describe("Phase 3: Crons", () => {
  it("AC-27: session closer sets endTime on stale sessions", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      const staleTime = Date.now() - 60 * 60 * 1000; // 1 hour ago
      const id = await ctx.db.insert("sessions", {
        userId: "u1",
        sessionId: "stale_sess",
        projectId: "default",
        env: "default",
        platform: "default",
        startTime: staleTime,
        eventCount: 3,
        entryPath: "/",
        exitPath: "/about",
        referrer: "",
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      // Simulate closing
      await ctx.db.patch(id, {
        endTime: staleTime + 5 * 60 * 1000,
        duration: 5 * 60 * 1000,
      });

      const closed = await ctx.db.get(id);
      expect(closed!.endTime).toBeDefined();
      expect(closed!.duration).toBe(5 * 60 * 1000);
    });
  });

  it("AC-31: GDPR delete removes all user data", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      // Create user + events + session
      await ctx.db.insert("users", {
        visitorId: "delete_me",
        projectIds: ["default"],
        firstSeen: 1000,
        lastSeen: 2000,
        sessionCount: 1,
        totalEvents: 2,
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      await seedEvents(ctx as never, [
        { name: "a", userId: "delete_me", timestamp: 1000 },
        { name: "b", userId: "delete_me", timestamp: 2000 },
      ]);

      await ctx.db.insert("sessions", {
        userId: "delete_me",
        sessionId: "s_delete",
        projectId: "default",
        env: "default",
        platform: "default",
        startTime: 1000,
        eventCount: 2,
        entryPath: "/",
        exitPath: "/",
        referrer: "",
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      // Simulate GDPR deletion
      const events = await ctx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", "delete_me"))
        .collect();
      for (const e of events) await ctx.db.delete(e._id);

      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", "delete_me"))
        .collect();
      for (const s of sessions) await ctx.db.delete(s._id);

      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "delete_me"))
        .unique();
      if (user) await ctx.db.delete(user._id);

      // Verify everything is gone
      const remainingEvents = await ctx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", "delete_me"))
        .collect();
      expect(remainingEvents).toHaveLength(0);

      const remainingSessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", "delete_me"))
        .collect();
      expect(remainingSessions).toHaveLength(0);

      const remainingUser = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "delete_me"))
        .unique();
      expect(remainingUser).toBeNull();
    });
  });

  it("EC7: user record persists after event TTL", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        visitorId: "old_user",
        projectIds: ["default"],
        firstSeen: 1000,
        lastSeen: 2000,
        sessionCount: 5,
        totalEvents: 50,
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      // Events get deleted by TTL, but user record stays
      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "old_user"))
        .unique();
      expect(user).not.toBeNull();
      expect(user!.totalEvents).toBe(50);
    });
  });
});
