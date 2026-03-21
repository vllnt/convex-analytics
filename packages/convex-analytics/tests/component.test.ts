/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../src/component/schema.js";

const modules = import.meta.glob("../src/component/**/*.ts");

describe("component isolation", () => {
  it("AC-7: component tables are defined correctly and isolated", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      // Insert into component's events table
      await ctx.db.insert("events", {
        userId: "u1",
        sessionId: "s1",
        name: "signup",
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
      });

      // Component has its own tables — verify events table exists and is queryable
      const events = await ctx.db.query("events").collect();
      expect(events).toHaveLength(1);

      // Verify sessions table exists (separate from app)
      const sessions = await ctx.db.query("sessions").collect();
      expect(sessions).toHaveLength(0);

      // Verify users table exists (separate from app)
      const users = await ctx.db.query("users").collect();
      expect(users).toHaveLength(0);

      // Verify all 7 tables are queryable (proves schema defines them)
      const rollups = await ctx.db.query("daily_rollups").collect();
      expect(rollups).toHaveLength(0);

      const schemas = await ctx.db.query("event_schemas").collect();
      expect(schemas).toHaveLength(0);

      const config = await ctx.db.query("config").collect();
      expect(config).toHaveLength(0);

      const archives = await ctx.db.query("archives").collect();
      expect(archives).toHaveLength(0);
    });
  });

  it("EC4: scoping provides logical isolation within single instance", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      // Insert events for two different projects
      await ctx.db.insert("events", {
        userId: "u1", sessionId: "s1", name: "signup",
        projectId: "app-a", env: "production", platform: "web",
        properties: {}, timestamp: 1000, path: "/", locale: "en",
        referrer: "", device: "desktop", browser: "Chrome", os: "macOS", country: "US", seqNum: 0,
      });
      await ctx.db.insert("events", {
        userId: "u2", sessionId: "s2", name: "signup",
        projectId: "app-b", env: "production", platform: "ios",
        properties: {}, timestamp: 2000, path: "/", locale: "en",
        referrer: "", device: "mobile", browser: "Safari", os: "iOS", country: "DE", seqNum: 0,
      });

      // Query scoped by projectId
      const appAEvents = await ctx.db
        .query("events")
        .withIndex("by_project_name", (q) =>
          q.eq("projectId", "app-a").eq("name", "signup"),
        )
        .collect();
      expect(appAEvents).toHaveLength(1);
      expect(appAEvents[0]!.projectId).toBe("app-a");

      const appBEvents = await ctx.db
        .query("events")
        .withIndex("by_project_name", (q) =>
          q.eq("projectId", "app-b").eq("name", "signup"),
        )
        .collect();
      expect(appBEvents).toHaveLength(1);
      expect(appBEvents[0]!.platform).toBe("ios");
    });
  });
});
