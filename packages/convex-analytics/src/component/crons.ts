import { internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { ShardedCounter } from "@convex-dev/sharded-counter";

const counter = new ShardedCounter(components.shardedCounter as never, {
  defaultShards: 16,
});

const BATCH_SIZE = 500;

/** Rollup cron (5min): aggregate new events into daily_rollups. Idempotent. */
export const rollup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const tenMinAgo = now - 10 * 60 * 1000;

    const recentEvents = await ctx.db
      .query("events")
      .order("desc")
      .take(5000);

    const relevantEvents = recentEvents.filter((e) => e.timestamp >= tenMinAgo);

    const groups = new Map<
      string,
      {
        name: string;
        projectId: string;
        env: string;
        date: string;
        count: number;
        users: Set<string>;
        dimensions: Record<string, Record<string, number>>;
      }
    >();

    for (const e of relevantEvents) {
      const date = new Date(e.timestamp).toISOString().split("T")[0]!;
      const key = `${e.name}:${e.projectId}:${e.env}:${date}`;

      if (!groups.has(key)) {
        groups.set(key, {
          name: e.name,
          projectId: e.projectId,
          env: e.env,
          date,
          count: 0,
          users: new Set(),
          dimensions: {},
        });
      }

      const g = groups.get(key)!;
      g.count++;
      g.users.add(e.userId);

      for (const dim of [
        "locale", "device", "country", "browser", "os", "path", "referrer", "platform",
      ] as const) {
        const val = e[dim] as string;
        if (!g.dimensions[dim]) g.dimensions[dim] = {};
        g.dimensions[dim]![val] = (g.dimensions[dim]![val] ?? 0) + 1;
      }
    }

    for (const [, g] of groups) {
      const existing = await ctx.db
        .query("daily_rollups")
        .withIndex("by_project_date", (q) =>
          q.eq("projectId", g.projectId).eq("name", g.name).eq("date", g.date),
        )
        .unique();

      if (existing) {
        const mergedDims = {
          ...((existing.dimensions as Record<string, Record<string, number>>) ?? {}),
        };
        for (const [dim, values] of Object.entries(g.dimensions)) {
          if (!mergedDims[dim]) mergedDims[dim] = {};
          for (const [val, cnt] of Object.entries(values)) {
            mergedDims[dim]![val] = Math.max(mergedDims[dim]![val] ?? 0, cnt);
          }
        }
        await ctx.db.patch(existing._id, {
          count: Math.max(existing.count, g.count),
          uniqueUsers: Math.max(existing.uniqueUsers, g.users.size),
          dimensions: mergedDims,
        });
      } else {
        await ctx.db.insert("daily_rollups", {
          name: g.name,
          projectId: g.projectId,
          env: g.env,
          date: g.date,
          count: g.count,
          uniqueUsers: g.users.size,
          dimensions: g.dimensions,
        });
      }
    }

    return null;
  },
});

/** Session closer (5min): close sessions with no events in 30min. */
export const closeInactiveSessions = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000;

    const activeSessions = await ctx.db
      .query("sessions")
      .withIndex("by_time")
      .take(1000);

    for (const session of activeSessions) {
      if (session.endTime !== undefined && session.duration !== undefined) continue;

      const lastEvent = await ctx.db
        .query("events")
        .withIndex("by_session", (q) => q.eq("sessionId", session.sessionId))
        .order("desc")
        .first();

      const lastActivity = lastEvent?.timestamp ?? session.startTime;
      if (lastActivity < thirtyMinAgo) {
        await ctx.db.patch(session._id, {
          endTime: lastActivity,
          duration: lastActivity - session.startTime,
        });
      }
    }

    return null;
  },
});

/** TTL cleanup (daily): delete events older than retention period. */
export const ttlCleanup = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const retentionConfig = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", "retention_days"))
      .unique();
    const retentionDays = retentionConfig ? parseInt(retentionConfig.value, 10) : 90;

    // Emergency mode: halve retention if storage >90%
    const storageConfig = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", "emergency_cleanup"))
      .unique();
    const effectiveRetention = storageConfig?.value === "true"
      ? Math.floor(retentionDays / 2)
      : retentionDays;

    const cutoff = Date.now() - effectiveRetention * 86400000;

    let deletedCount = 0;
    let hasMore = true;
    while (hasMore && deletedCount < 5000) {
      const oldEvents = await ctx.db
        .query("events")
        .order("asc")
        .take(BATCH_SIZE);

      const toDelete = oldEvents.filter((e) => e.timestamp < cutoff);
      if (toDelete.length === 0) {
        hasMore = false;
        break;
      }

      for (const event of toDelete) {
        await ctx.db.delete(event._id);
        deletedCount++;
      }

      if (toDelete.length < BATCH_SIZE) hasMore = false;
    }

    if (deletedCount > 0) {
      console.log(`[convex-analytics] TTL cleanup: deleted ${deletedCount} events older than ${effectiveRetention} days`);
    }

    return null;
  },
});

/** Monitor (weekly): log storage usage warnings. */
export const monitor = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const events = await ctx.db.query("events").take(10001);
    const eventCount = events.length;

    const sessions = await ctx.db.query("sessions").take(10001);
    const sessionCount = sessions.length;

    const users = await ctx.db.query("users").take(10001);
    const userCount = users.length;

    const thresholdConfig = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", "alert_threshold"))
      .unique();
    const warningThreshold = thresholdConfig ? parseInt(thresholdConfig.value, 10) : 8000;

    if (eventCount >= warningThreshold) {
      console.warn(
        `[convex-analytics] Storage warning: ${eventCount}+ events, ${sessionCount}+ sessions, ${userCount}+ users. Consider reducing retention.`,
      );
    } else {
      console.log(
        `[convex-analytics] Monitor: ${eventCount} events, ${sessionCount} sessions, ${userCount} users. OK.`,
      );
    }

    return null;
  },
});

/** Rebalance (weekly): verify sharded counter counts match actual event counts. */
export const rebalance = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const schemas = await ctx.db.query("event_schemas").collect();
    const names = schemas.map((s) => s.name).slice(0, 10);

    for (const name of names) {
      const counterCount = await counter.count(ctx, name);
      const actualEvents = await ctx.db
        .query("events")
        .withIndex("by_name_time", (q) => q.eq("name", name))
        .take(10001);

      const actualCount = actualEvents.length;
      if (actualCount >= 10001) continue;

      const drift = Math.abs(counterCount - actualCount);
      const driftPct = actualCount > 0 ? drift / actualCount : 0;

      if (driftPct > 0.01) {
        console.warn(
          `[convex-analytics] Counter drift: "${name}" counter=${counterCount} actual=${actualCount} drift=${(driftPct * 100).toFixed(1)}%`,
        );
      }
    }

    return null;
  },
});

/** GDPR deletion: remove ALL data for a userId. */
export const deleteUser = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    let hasMore = true;
    while (hasMore) {
      const events = await ctx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
        .take(BATCH_SIZE);
      if (events.length === 0) {
        hasMore = false;
      } else {
        for (const event of events) {
          await ctx.db.delete(event._id);
        }
        if (events.length < BATCH_SIZE) hasMore = false;
      }
    }

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.userId))
      .unique();
    if (user) {
      await ctx.db.delete(user._id);
    }

    console.log(`[convex-analytics] GDPR deletion complete for userId: ${args.userId}`);
    return null;
  },
});
