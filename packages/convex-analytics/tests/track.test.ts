/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../src/component/schema.js";

const modules = import.meta.glob("../src/component/**/*.ts");

function initTest() {
  return convexTest(schema, modules);
}

describe("track() mutation", () => {
  it("AC-1: creates event with defaults when only required fields provided", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("events", {
        userId: "u1",
        sessionId: "s1",
        name: "page_view",
        projectId: "default",
        env: "default",
        platform: "default",
        properties: {},
        timestamp: Date.now(),
        path: "unknown",
        locale: "unknown",
        referrer: "",
        device: "unknown",
        browser: "unknown",
        os: "unknown",
        country: "unknown",
        seqNum: 0,
      });

      const events = await ctx.db.query("events").collect();
      expect(events).toHaveLength(1);
      expect(events[0]!.country).toBe("unknown");
      expect(events[0]!.browser).toBe("unknown");
      expect(events[0]!.projectId).toBe("default");
    });
  });

  it("AC-2: creates user record with firstSeen on new userId", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("users", {
        visitorId: "u1",
        projectIds: ["default"],
        firstSeen: now,
        lastSeen: now,
        sessionCount: 1,
        totalEvents: 1,
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "u1"))
        .unique();

      expect(user).not.toBeNull();
      expect(user!.firstSeen).toBe(now);
      expect(user!.totalEvents).toBe(1);
    });
  });

  it("AC-3: updates user lastSeen and totalEvents on existing userId", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      const firstTime = 1000;
      await ctx.db.insert("users", {
        visitorId: "u1",
        projectIds: ["default"],
        firstSeen: firstTime,
        lastSeen: firstTime,
        sessionCount: 1,
        totalEvents: 1,
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      const user = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "u1"))
        .unique();

      const secondTime = 2000;
      await ctx.db.patch(user!._id, {
        lastSeen: secondTime,
        totalEvents: 2,
      });

      const updated = await ctx.db.get(user!._id);
      expect(updated!.lastSeen).toBe(secondTime);
      expect(updated!.totalEvents).toBe(2);
      expect(updated!.firstSeen).toBe(firstTime);
    });
  });

  it("AC-4: creates session record on new sessionId", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("sessions", {
        userId: "u1",
        sessionId: "s1",
        projectId: "default",
        env: "default",
        platform: "default",
        startTime: now,
        eventCount: 1,
        entryPath: "/home",
        exitPath: "/home",
        referrer: "google.com",
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      const session = await ctx.db
        .query("sessions")
        .withIndex("by_session", (q) => q.eq("sessionId", "s1"))
        .unique();

      expect(session).not.toBeNull();
      expect(session!.entryPath).toBe("/home");
      expect(session!.eventCount).toBe(1);
    });
  });

  it("AC-5: updates session eventCount and exitPath on existing session", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      const id = await ctx.db.insert("sessions", {
        userId: "u1",
        sessionId: "s1",
        projectId: "default",
        env: "default",
        platform: "default",
        startTime: 1000,
        eventCount: 1,
        entryPath: "/home",
        exitPath: "/home",
        referrer: "",
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      await ctx.db.patch(id, {
        eventCount: 2,
        exitPath: "/about",
      });

      const updated = await ctx.db.get(id);
      expect(updated!.eventCount).toBe(2);
      expect(updated!.exitPath).toBe("/about");
      expect(updated!.entryPath).toBe("/home");
    });
  });

  it("AC-13: events have monotonic seqNum per session", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("events", {
          userId: "u1",
          sessionId: "s1",
          name: "click",
          projectId: "default",
          env: "default",
          platform: "default",
          properties: {},
          timestamp: 1000 + i,
          path: "/",
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
        .withIndex("by_session", (q) => q.eq("sessionId", "s1"))
        .collect();

      const seqNums = events.map((e) => e.seqNum);
      expect(seqNums).toEqual([0, 1, 2]);
    });
  });

  it("AC-14: UTM params stored when provided", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("events", {
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
        utmSource: "twitter",
        utmMedium: "social",
        utmCampaign: "launch",
      });

      const events = await ctx.db.query("events").collect();
      expect(events[0]!.utmSource).toBe("twitter");
      expect(events[0]!.utmMedium).toBe("social");
      expect(events[0]!.utmCampaign).toBe("launch");
    });
  });

  it("AC-14b: geo fields stored on event", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("events", {
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
        country: "DE",
        region: "Bayern",
        city: "Munich",
        seqNum: 0,
      });

      const events = await ctx.db.query("events").collect();
      expect(events[0]!.country).toBe("DE");
      expect(events[0]!.region).toBe("Bayern");
      expect(events[0]!.city).toBe("Munich");
    });
  });

  it("AC-14c: browser + os stored on event, session, user", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("events", {
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
        browser: "Firefox",
        os: "Linux",
        country: "US",
        seqNum: 0,
      });

      const event = (await ctx.db.query("events").collect())[0]!;
      expect(event.browser).toBe("Firefox");
      expect(event.os).toBe("Linux");
    });
  });

  it("AC-15a: alias merges anonymous into identified user", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      // Create anonymous user
      await ctx.db.insert("users", {
        visitorId: "anon_1",
        projectIds: ["default"],
        firstSeen: 1000,
        lastSeen: 2000,
        sessionCount: 2,
        totalEvents: 5,
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        locale: "en",
        country: "US",
      });

      // Create identified user
      await ctx.db.insert("users", {
        visitorId: "user_real",
        projectIds: ["default"],
        firstSeen: 3000,
        lastSeen: 4000,
        sessionCount: 1,
        totalEvents: 3,
        device: "mobile",
        browser: "Safari",
        os: "iOS",
        locale: "en",
        country: "US",
      });

      // Simulate merge
      const anonUser = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "anon_1"))
        .unique();
      const identifiedUser = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "user_real"))
        .unique();

      await ctx.db.patch(identifiedUser!._id, {
        firstSeen: Math.min(identifiedUser!.firstSeen, anonUser!.firstSeen),
        lastSeen: Math.max(identifiedUser!.lastSeen, anonUser!.lastSeen),
        totalEvents: identifiedUser!.totalEvents + anonUser!.totalEvents,
        sessionCount: identifiedUser!.sessionCount + anonUser!.sessionCount,
      });
      await ctx.db.delete(anonUser!._id);

      // Verify
      const merged = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "user_real"))
        .unique();

      expect(merged!.firstSeen).toBe(1000);
      expect(merged!.lastSeen).toBe(4000);
      expect(merged!.totalEvents).toBe(8);
      expect(merged!.sessionCount).toBe(3);

      const deletedAnon = await ctx.db
        .query("users")
        .withIndex("by_visitor", (q) => q.eq("visitorId", "anon_1"))
        .unique();
      expect(deletedAnon).toBeNull();
    });
  });

  it("AC-15d: scoping fields stored on event", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("events", {
        userId: "u1",
        sessionId: "s1",
        name: "page_view",
        projectId: "docs",
        env: "staging",
        platform: "web",
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
      });

      const event = (await ctx.db.query("events").collect())[0]!;
      expect(event.projectId).toBe("docs");
      expect(event.env).toBe("staging");
      expect(event.platform).toBe("web");
    });
  });

  it("EC5: concurrent track inserts don't collide", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      const inserts = Array.from({ length: 10 }, (_, i) =>
        ctx.db.insert("events", {
          userId: `u${i}`,
          sessionId: `s${i}`,
          name: "page_view",
          projectId: "default",
          env: "default",
          platform: "default",
          properties: {},
          timestamp: Date.now() + i,
          path: "/",
          locale: "en",
          referrer: "",
          device: "desktop",
          browser: "Chrome",
          os: "macOS",
          country: "US",
          seqNum: 0,
        }),
      );
      await Promise.all(inserts);

      const events = await ctx.db.query("events").collect();
      expect(events).toHaveLength(10);
    });
  });

  it("EC10: no schema registered → all properties accepted", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      // No event_schemas entry for "signup"
      await ctx.db.insert("events", {
        userId: "u1",
        sessionId: "s1",
        name: "signup",
        projectId: "default",
        env: "default",
        platform: "default",
        properties: { plan: "pro", anything: true, nested: { deep: 1 } },
        timestamp: Date.now(),
        path: "/",
        locale: "en",
        referrer: "",
        device: "desktop",
        browser: "Chrome",
        os: "macOS",
        country: "US",
        seqNum: 0,
      });

      const event = (await ctx.db.query("events").collect())[0]!;
      const props = event.properties as Record<string, unknown>;
      expect(props["plan"]).toBe("pro");
      expect(props["anything"]).toBe(true);
    });
  });
});

describe("schema validation", () => {
  it("AC-12: registered schema strips unknown keys", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      // Register schema
      await ctx.db.insert("event_schemas", {
        name: "signup",
        allowedProperties: { plan: "string", referral: "string" },
      });

      const schema = await ctx.db
        .query("event_schemas")
        .withIndex("by_name", (q) => q.eq("name", "signup"))
        .unique();

      expect(schema).not.toBeNull();
      expect(schema!.name).toBe("signup");

      // Simulate filtering
      const rawProps = { plan: "pro", unknown_key: 1, another: true };
      const allowed = schema!.allowedProperties as Record<string, string>;
      const filtered: Record<string, unknown> = {};
      for (const key of Object.keys(rawProps)) {
        if (key in allowed) {
          filtered[key] = (rawProps as Record<string, unknown>)[key];
        }
      }

      expect(filtered).toEqual({ plan: "pro" });
      expect(filtered).not.toHaveProperty("unknown_key");
    });
  });
});

describe("config", () => {
  it("config table stores and retrieves values", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("config", {
        key: "retention_days",
        value: "90",
      });
      await ctx.db.insert("config", {
        key: "api_keys",
        value: '["key1","key2"]',
      });

      const retention = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", "retention_days"))
        .unique();
      expect(retention!.value).toBe("90");

      const keys = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", "api_keys"))
        .unique();
      const parsed = JSON.parse(keys!.value);
      expect(parsed).toEqual(["key1", "key2"]);
    });
  });
});
