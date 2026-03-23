/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api, internal } from "../src/component/_generated/api.js";
import schema from "../src/component/schema.js";

const modules = import.meta.glob("../src/component/**/*.ts");

function initTest() {
  return convexTest(schema, modules);
}

/**
 * NOTE: track.track() is NOT tested here because it depends on child components
 * (rateLimiter, aggregate, shardedCounter) which are not available in convex-test
 * without child component registration. The track() mutation would fail at the
 * rateLimiter.limit() call. Use the existing track.test.ts for DB-level seeding tests.
 */

function makeEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "u1",
    sessionId: "s1",
    name: "page_view",
    projectId: "default",
    env: "default",
    platform: "default",
    properties: {},
    timestamp: Date.now(),
    path: "/",
    locale: "en",
    referrer: "",
    device: "desktop",
    browser: "Chrome",
    os: "macOS",
    country: "US",
    seqNum: 0,
    ...overrides,
  };
}

function makeUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    visitorId: "u1",
    projectIds: ["default"],
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    sessionCount: 1,
    totalEvents: 1,
    device: "desktop",
    browser: "Chrome",
    os: "macOS",
    locale: "en",
    country: "US",
    ...overrides,
  };
}

function makeSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: "u1",
    sessionId: "s1",
    projectId: "default",
    env: "default",
    platform: "default",
    startTime: Date.now(),
    eventCount: 1,
    entryPath: "/",
    exitPath: "/",
    referrer: "",
    device: "desktop",
    browser: "Chrome",
    os: "macOS",
    locale: "en",
    country: "US",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/*  track.identify                                                            */
/* -------------------------------------------------------------------------- */

describe("track.identify", () => {
  it("updates user device trait when user exists", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", makeUser({ visitorId: "u1", device: "desktop" }) as never);
    });

    await t.mutation(api.track.identify, {
      userId: "u1",
      traits: { device: "mobile" },
    });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "u1"))
        .unique();
      expect(user).not.toBeNull();
      expect(user!.device).toBe("mobile");
    });
  });

  it("returns null (no-op) for non-existent user", async () => {
    const t = initTest();

    const result = await t.mutation(api.track.identify, {
      userId: "does_not_exist",
      traits: { device: "mobile" },
    });
    expect(result).toBeNull();
  });

  it("only applies known traits (device, browser, os, locale, country)", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert(
        "users",
        makeUser({
          visitorId: "u1",
          device: "desktop",
          browser: "Chrome",
          os: "macOS",
          locale: "en",
          country: "US",
        }) as never,
      );
    });

    await t.mutation(api.track.identify, {
      userId: "u1",
      traits: {
        device: "tablet",
        browser: "Firefox",
        os: "Linux",
        locale: "de",
        country: "DE",
        favoriteColor: "blue",
        age: 42,
        plan: "enterprise",
      },
    });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "u1"))
        .unique();
      expect(user!.device).toBe("tablet");
      expect(user!.browser).toBe("Firefox");
      expect(user!.os).toBe("Linux");
      expect(user!.locale).toBe("de");
      expect(user!.country).toBe("DE");
      /* Unknown traits are NOT on the user schema — they are silently ignored */
    });
  });

  it("no-ops when traits object is empty", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", makeUser({ visitorId: "u1", device: "desktop" }) as never);
    });

    await t.mutation(api.track.identify, { userId: "u1", traits: {} });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "u1"))
        .unique();
      expect(user!.device).toBe("desktop");
    });
  });

  it("ignores non-string trait values", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", makeUser({ visitorId: "u1", device: "desktop" }) as never);
    });

    await t.mutation(api.track.identify, {
      userId: "u1",
      traits: { device: 123, browser: true, os: null },
    });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "u1"))
        .unique();
      expect(user!.device).toBe("desktop");
      expect(user!.browser).toBe("Chrome");
      expect(user!.os).toBe("macOS");
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  track.alias                                                               */
/* -------------------------------------------------------------------------- */

describe("track.alias", () => {
  it("reassigns events, sessions, and merges users", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert(
        "users",
        makeUser({
          visitorId: "anon_1",
          projectIds: ["proj_a"],
          firstSeen: 1000,
          lastSeen: 3000,
          sessionCount: 2,
          totalEvents: 5,
        }) as never,
      );
      await ctx.db.insert(
        "users",
        makeUser({
          visitorId: "real_1",
          projectIds: ["proj_b"],
          firstSeen: 2000,
          lastSeen: 4000,
          sessionCount: 1,
          totalEvents: 3,
        }) as never,
      );

      await ctx.db.insert("events", makeEvent({ userId: "anon_1", sessionId: "s_a1", timestamp: now }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "anon_1", sessionId: "s_a1", timestamp: now + 1, seqNum: 1 }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "real_1", sessionId: "s_r1", timestamp: now + 2 }) as never);

      await ctx.db.insert("sessions", makeSession({ userId: "anon_1", sessionId: "s_a1" }) as never);
      await ctx.db.insert("sessions", makeSession({ userId: "real_1", sessionId: "s_r1" }) as never);
    });

    await t.mutation(api.track.alias, {
      anonymousId: "anon_1",
      identifiedId: "real_1",
    });

    await t.run(async (ctx) => {
      const anonEvents = await ctx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", "anon_1"))
        .collect();
      expect(anonEvents).toHaveLength(0);

      const realEvents = await ctx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", "real_1"))
        .collect();
      expect(realEvents).toHaveLength(3);

      const anonSessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", "anon_1"))
        .collect();
      expect(anonSessions).toHaveLength(0);

      const realSessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", "real_1"))
        .collect();
      expect(realSessions).toHaveLength(2);

      const mergedUser = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "real_1"))
        .unique();
      expect(mergedUser).not.toBeNull();
      expect(mergedUser!.firstSeen).toBe(1000);
      expect(mergedUser!.lastSeen).toBe(4000);
      expect(mergedUser!.totalEvents).toBe(8);
      expect(mergedUser!.sessionCount).toBe(3);
      expect(mergedUser!.projectIds.sort()).toEqual(["proj_a", "proj_b"]);

      const deletedAnon = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "anon_1"))
        .unique();
      expect(deletedAnon).toBeNull();
    });
  });

  it("self-alias (same id) is a no-op", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", makeUser({ visitorId: "u1" }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "u1" }) as never);
    });

    await t.mutation(api.track.alias, {
      anonymousId: "u1",
      identifiedId: "u1",
    });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "u1"))
        .unique();
      expect(user).not.toBeNull();
      expect(user!.totalEvents).toBe(1);
    });
  });

  it("alias with non-existent anonymous user is a no-op", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", makeUser({ visitorId: "real_1" }) as never);
    });

    await t.mutation(api.track.alias, {
      anonymousId: "ghost",
      identifiedId: "real_1",
    });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "real_1"))
        .unique();
      expect(user).not.toBeNull();
      expect(user!.totalEvents).toBe(1);
    });
  });

  it("alias when identified user does not exist renames anonymous user", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert(
        "users",
        makeUser({ visitorId: "anon_1", totalEvents: 7, sessionCount: 3 }) as never,
      );
      await ctx.db.insert("events", makeEvent({ userId: "anon_1" }) as never);
      await ctx.db.insert("sessions", makeSession({ userId: "anon_1", sessionId: "s_a" }) as never);
    });

    await t.mutation(api.track.alias, {
      anonymousId: "anon_1",
      identifiedId: "new_user",
    });

    await t.run(async (ctx) => {
      const oldUser = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "anon_1"))
        .unique();
      expect(oldUser).toBeNull();

      const renamedUser = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "new_user"))
        .unique();
      expect(renamedUser).not.toBeNull();
      expect(renamedUser!.totalEvents).toBe(7);
      expect(renamedUser!.sessionCount).toBe(3);

      const events = await ctx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", "new_user"))
        .collect();
      expect(events).toHaveLength(1);

      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", "new_user"))
        .collect();
      expect(sessions).toHaveLength(1);
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  crons.rollup                                                              */
/* -------------------------------------------------------------------------- */

describe("crons.rollup", () => {
  it("aggregates recent events into daily_rollups", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("events", makeEvent({ userId: "u1", timestamp: now - 60_000, name: "page_view" }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "u2", timestamp: now - 120_000, name: "page_view" }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "u1", timestamp: now - 180_000, name: "signup" }) as never);
    });

    await t.mutation(internal.crons.rollup, {});

    await t.run(async (ctx) => {
      const rollups = await ctx.db.query("daily_rollups").collect();
      expect(rollups.length).toBeGreaterThanOrEqual(1);

      const todayDate = new Date(now).toISOString().split("T")[0]!;

      const pvRollup = rollups.find((r) => r.name === "page_view" && r.date === todayDate);
      expect(pvRollup).toBeDefined();
      expect(pvRollup!.count).toBe(2);
      expect(pvRollup!.uniqueUsers).toBe(2);

      const dims = pvRollup!.dimensions as Record<string, Record<string, number>>;
      expect(dims["device"]?.["desktop"]).toBe(2);
      expect(dims["browser"]?.["Chrome"]).toBe(2);

      const signupRollup = rollups.find((r) => r.name === "signup" && r.date === todayDate);
      expect(signupRollup).toBeDefined();
      expect(signupRollup!.count).toBe(1);
      expect(signupRollup!.uniqueUsers).toBe(1);
    });
  });

  it("rollup is idempotent — uses Math.max, not sum", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("events", makeEvent({ userId: "u1", timestamp: now - 60_000, name: "click" }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "u2", timestamp: now - 120_000, name: "click" }) as never);
    });

    await t.mutation(internal.crons.rollup, {});
    await t.mutation(internal.crons.rollup, {});

    await t.run(async (ctx) => {
      const todayDate = new Date(now).toISOString().split("T")[0]!;
      const rollups = await ctx.db
        .query("daily_rollups")
        .withIndex("by_name_date", (q) => q.eq("name", "click").eq("date", todayDate))
        .collect();

      expect(rollups).toHaveLength(1);
      expect(rollups[0]!.count).toBe(2);
      expect(rollups[0]!.uniqueUsers).toBe(2);
    });
  });

  it("ignores events older than 10 minutes", async () => {
    const t = initTest();

    const now = Date.now();
    const fifteenMinAgo = now - 15 * 60 * 1000;

    await t.run(async (ctx) => {
      await ctx.db.insert("events", makeEvent({ userId: "u1", timestamp: fifteenMinAgo, name: "old_event" }) as never);
    });

    await t.mutation(internal.crons.rollup, {});

    await t.run(async (ctx) => {
      const rollups = await ctx.db.query("daily_rollups").collect();
      const oldRollup = rollups.find((r) => r.name === "old_event");
      expect(oldRollup).toBeUndefined();
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  crons.closeInactiveSessions                                               */
/* -------------------------------------------------------------------------- */

describe("crons.closeInactiveSessions", () => {
  it("closes sessions with no events in last 30 minutes", async () => {
    const t = initTest();

    const now = Date.now();
    const fortyMinAgo = now - 40 * 60 * 1000;

    await t.run(async (ctx) => {
      await ctx.db.insert(
        "sessions",
        makeSession({
          userId: "u1",
          sessionId: "s_old",
          startTime: fortyMinAgo,
          eventCount: 2,
        }) as never,
      );

      await ctx.db.insert(
        "events",
        makeEvent({
          userId: "u1",
          sessionId: "s_old",
          timestamp: fortyMinAgo + 60_000,
        }) as never,
      );
    });

    await t.mutation(internal.crons.closeInactiveSessions, {});

    await t.run(async (ctx) => {
      const session = await ctx.db
        .query("sessions")
        .withIndex("by_session", (q) => q.eq("sessionId", "s_old"))
        .unique();
      expect(session).not.toBeNull();
      expect(session!.endTime).toBeDefined();
      expect(session!.duration).toBeDefined();
      expect(session!.endTime).toBe(fortyMinAgo + 60_000);
      expect(session!.duration).toBe(60_000);
    });
  });

  it("does NOT close sessions with recent events", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert(
        "sessions",
        makeSession({
          userId: "u1",
          sessionId: "s_active",
          startTime: now - 5 * 60 * 1000,
          eventCount: 3,
        }) as never,
      );

      await ctx.db.insert(
        "events",
        makeEvent({
          userId: "u1",
          sessionId: "s_active",
          timestamp: now - 60_000,
        }) as never,
      );
    });

    await t.mutation(internal.crons.closeInactiveSessions, {});

    await t.run(async (ctx) => {
      const session = await ctx.db
        .query("sessions")
        .withIndex("by_session", (q) => q.eq("sessionId", "s_active"))
        .unique();
      expect(session).not.toBeNull();
      expect(session!.endTime).toBeUndefined();
      expect(session!.duration).toBeUndefined();
    });
  });

  it("skips already-closed sessions", async () => {
    const t = initTest();

    const now = Date.now();
    const fortyMinAgo = now - 40 * 60 * 1000;

    await t.run(async (ctx) => {
      await ctx.db.insert(
        "sessions",
        makeSession({
          userId: "u1",
          sessionId: "s_closed",
          startTime: fortyMinAgo,
          endTime: fortyMinAgo + 30_000,
          duration: 30_000,
          eventCount: 1,
        }) as never,
      );
    });

    await t.mutation(internal.crons.closeInactiveSessions, {});

    await t.run(async (ctx) => {
      const session = await ctx.db
        .query("sessions")
        .withIndex("by_session", (q) => q.eq("sessionId", "s_closed"))
        .unique();
      expect(session!.endTime).toBe(fortyMinAgo + 30_000);
      expect(session!.duration).toBe(30_000);
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  crons.ttlCleanup                                                          */
/* -------------------------------------------------------------------------- */

describe("crons.ttlCleanup", () => {
  it("deletes events older than retention period and preserves recent ones", async () => {
    const t = initTest();

    const now = Date.now();
    const twoDaysAgo = now - 2 * 86_400_000;

    await t.run(async (ctx) => {
      await ctx.db.insert("config", { key: "retention_days", value: "1" });

      await ctx.db.insert("events", makeEvent({ userId: "u1", timestamp: twoDaysAgo, name: "old" }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "u1", timestamp: twoDaysAgo - 3600_000, name: "old2", seqNum: 1 }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "u1", timestamp: now - 60_000, name: "recent" }) as never);
    });

    await t.mutation(internal.crons.ttlCleanup, {});

    await t.run(async (ctx) => {
      const events = await ctx.db.query("events").collect();
      expect(events).toHaveLength(1);
      expect(events[0]!.name).toBe("recent");
    });
  });

  it("uses default 90-day retention when no config exists", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert(
        "events",
        makeEvent({ userId: "u1", timestamp: now - 60_000, name: "recent" }) as never,
      );
    });

    await t.mutation(internal.crons.ttlCleanup, {});

    await t.run(async (ctx) => {
      const events = await ctx.db.query("events").collect();
      expect(events).toHaveLength(1);
    });
  });
});

/* -------------------------------------------------------------------------- */
/*  crons.monitor                                                             */
/* -------------------------------------------------------------------------- */

describe("crons.monitor", () => {
  it("runs without crashing on empty database", async () => {
    const t = initTest();

    const result = await t.mutation(internal.crons.monitor, {});
    expect(result).toBeNull();
  });

  it("runs without crashing with seeded events", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert(
          "events",
          makeEvent({ userId: `u${i}`, timestamp: now - i * 1000, seqNum: i }) as never,
        );
      }
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert(
          "sessions",
          makeSession({ userId: `u${i}`, sessionId: `s${i}` }) as never,
        );
      }
      await ctx.db.insert("users", makeUser({ visitorId: "u0" }) as never);
    });

    const result = await t.mutation(internal.crons.monitor, {});
    expect(result).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  crons.deleteUser                                                          */
/* -------------------------------------------------------------------------- */

describe("crons.deleteUser", () => {
  it("deletes all data for a userId (events, sessions, user record)", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", makeUser({ visitorId: "target" }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "target", sessionId: "s_t1", timestamp: now }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "target", sessionId: "s_t1", timestamp: now + 1, seqNum: 1 }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "target", sessionId: "s_t2", timestamp: now + 2 }) as never);
      await ctx.db.insert("sessions", makeSession({ userId: "target", sessionId: "s_t1" }) as never);
      await ctx.db.insert("sessions", makeSession({ userId: "target", sessionId: "s_t2" }) as never);
    });

    await t.mutation(internal.crons.deleteUser, { userId: "target" });

    await t.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "target"))
        .unique();
      expect(user).toBeNull();

      const events = await ctx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", "target"))
        .collect();
      expect(events).toHaveLength(0);

      const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", "target"))
        .collect();
      expect(sessions).toHaveLength(0);
    });
  });

  it("does NOT affect other users' data", async () => {
    const t = initTest();

    const now = Date.now();

    await t.run(async (ctx) => {
      await ctx.db.insert("users", makeUser({ visitorId: "target" }) as never);
      await ctx.db.insert("users", makeUser({ visitorId: "bystander" }) as never);

      await ctx.db.insert("events", makeEvent({ userId: "target", sessionId: "s_t", timestamp: now }) as never);
      await ctx.db.insert("events", makeEvent({ userId: "bystander", sessionId: "s_b", timestamp: now }) as never);

      await ctx.db.insert("sessions", makeSession({ userId: "target", sessionId: "s_t" }) as never);
      await ctx.db.insert("sessions", makeSession({ userId: "bystander", sessionId: "s_b" }) as never);
    });

    await t.mutation(internal.crons.deleteUser, { userId: "target" });

    await t.run(async (ctx) => {
      const bystander = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "bystander"))
        .unique();
      expect(bystander).not.toBeNull();

      const bEvents = await ctx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", "bystander"))
        .collect();
      expect(bEvents).toHaveLength(1);

      const bSessions = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", "bystander"))
        .collect();
      expect(bSessions).toHaveLength(1);
    });
  });

  it("no-ops when userId does not exist", async () => {
    const t = initTest();

    const result = await t.mutation(internal.crons.deleteUser, { userId: "ghost" });
    expect(result).toBeNull();
  });
});
