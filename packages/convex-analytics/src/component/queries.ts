import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { ShardedCounter } from "@convex-dev/sharded-counter";

const counter = new ShardedCounter(components.shardedCounter as never, {
  defaultShards: 16,
});

export const list = query({
  args: {
    name: v.string(),
    projectId: v.optional(v.string()),
    env: v.optional(v.string()),
    platform: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 100);

    // H3: Use by_project_name index when projectId is provided for correct pagination
    if (args.projectId) {
      let q = ctx.db
        .query("events")
        .withIndex("by_project_name", (q) =>
          q.eq("projectId", args.projectId!).eq("name", args.name),
        )
        .order("desc");

      const results = await q.take(limit + 1);
      const hasMore = results.length > limit;
      const data = results.slice(0, limit);

      return { data, hasMore };
    }

    // Default: by_name_time index
    const q = ctx.db
      .query("events")
      .withIndex("by_name_time", (q) => q.eq("name", args.name))
      .order("desc");

    const results = await q.take(limit + 1);
    const hasMore = results.length > limit;
    const data = results.slice(0, limit);

    // Post-filter by env/platform if specified (no compound index for these)
    const filtered = data.filter((e) => {
      if (args.env && e.env !== args.env) return false;
      if (args.platform && e.platform !== args.platform) return false;
      return true;
    });

    return { data: filtered, hasMore };
  },
});

export const count = query({
  args: {
    name: v.string(),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.from !== undefined || args.to !== undefined) {
      // H2: Use daily_rollups for time-bounded count instead of .collect()
      const rollups = await ctx.db
        .query("daily_rollups")
        .withIndex("by_name_date", (q) => q.eq("name", args.name))
        .collect();

      // Filter by date range
      let total = 0;
      const fromDate = args.from ? new Date(args.from).toISOString().split("T")[0]! : null;
      const toDate = args.to ? new Date(args.to).toISOString().split("T")[0]! : null;

      for (const rollup of rollups) {
        if (fromDate && rollup.date < fromDate) continue;
        if (toDate && rollup.date > toDate) continue;
        total += rollup.count;
      }
      return total;
    }
    // Total count via sharded counter — O(shards) not O(n)
    return await counter.count(ctx, args.name);
  },
});

export const summary = query({
  args: {
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // H1: Get event names from event_schemas + daily_rollups (no raw event table scan)
    const schemas = await ctx.db.query("event_schemas").collect();
    const names = new Set(schemas.map((s) => s.name));

    // Also discover names from daily_rollups (covers events without schemas)
    const rollups = await ctx.db.query("daily_rollups").collect();
    for (const r of rollups) {
      if (args.projectId && r.projectId !== args.projectId) continue;
      names.add(r.name);
    }

    const result: Array<{ name: string; count: number }> = [];
    for (const name of names) {
      const c = await counter.count(ctx, name);
      if (c > 0) {
        result.push({ name, count: c });
      }
    }

    result.sort((a, b) => b.count - a.count);
    return result;
  },
});

// ─── Phase 2: Analytics Queries ───────────────────────────────────────────

export const timeseries = query({
  args: {
    name: v.string(),
    interval: v.union(v.literal("day"), v.literal("week"), v.literal("month")),
    projectId: v.optional(v.string()),
    env: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const rollups = await ctx.db
      .query("daily_rollups")
      .withIndex("by_name_date", (q) => q.eq("name", args.name))
      .collect();

    const fromDate = args.from ? new Date(args.from).toISOString().split("T")[0]! : null;
    const toDate = args.to ? new Date(args.to).toISOString().split("T")[0]! : null;

    const filtered = rollups.filter((r) => {
      if (fromDate && r.date < fromDate) return false;
      if (toDate && r.date > toDate) return false;
      if (args.projectId && r.projectId !== args.projectId) return false;
      if (args.env && r.env !== args.env) return false;
      return true;
    });

    if (args.interval === "day") {
      return filtered.map((r) => ({
        date: r.date,
        count: r.count,
        uniques: r.uniqueUsers,
      }));
    }

    // Bucket by week or month
    const buckets = new Map<string, { count: number; uniques: number }>();
    for (const r of filtered) {
      const d = new Date(r.date);
      let bucketKey: string;
      if (args.interval === "week") {
        const day = d.getDay();
        const monday = new Date(d);
        monday.setDate(d.getDate() - ((day + 6) % 7));
        bucketKey = monday.toISOString().split("T")[0]!;
      } else {
        bucketKey = r.date.substring(0, 7); // YYYY-MM
      }
      const existing = buckets.get(bucketKey) ?? { count: 0, uniques: 0 };
      existing.count += r.count;
      existing.uniques += r.uniqueUsers;
      buckets.set(bucketKey, existing);
    }

    return [...buckets.entries()]
      .map(([date, data]) => ({ date, count: data.count, uniques: data.uniques }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});

export const funnel = query({
  args: {
    steps: v.array(v.string()),
    window: v.optional(v.string()),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.steps.length < 2) {
      throw new Error("Funnel requires at least 2 steps");
    }

    const windowMs = parseWindow(args.window ?? "7d");
    const now = Date.now();
    const from = args.from ?? now - 30 * 24 * 60 * 60 * 1000;
    const to = args.to ?? now;

    // Get all users who fired the first step in the time range
    const firstStepEvents = await ctx.db
      .query("events")
      .withIndex("by_name_time", (q) =>
        q.eq("name", args.steps[0]!).gte("timestamp", from).lte("timestamp", to),
      )
      .take(10000);

    const userIds = [...new Set(firstStepEvents.map((e) => e.userId))];
    const results: Array<{
      step: string;
      count: number;
      rate: number;
      dropoff: number;
    }> = [];

    let previousUsers = new Set(userIds);

    for (let i = 0; i < args.steps.length; i++) {
      const stepName = args.steps[i]!;

      if (i === 0) {
        results.push({
          step: stepName,
          count: previousUsers.size,
          rate: 1,
          dropoff: 0,
        });
        continue;
      }

      const qualifiedUsers = new Set<string>();
      for (const userId of previousUsers) {
        const events = await ctx.db
          .query("events")
          .withIndex("by_user_time", (q) =>
            q.eq("userId", userId).gte("timestamp", from).lte("timestamp", to),
          )
          .take(1000);

        const stepEvent = events.find(
          (e) => e.name === stepName && e.timestamp <= from + windowMs,
        );
        if (stepEvent) {
          qualifiedUsers.add(userId);
        }
      }

      const prevCount = previousUsers.size;
      const currentCount = qualifiedUsers.size;
      results.push({
        step: stepName,
        count: currentCount,
        rate: prevCount > 0 ? currentCount / prevCount : 0,
        dropoff: prevCount > 0 ? (prevCount - currentCount) / prevCount : 0,
      });
      previousUsers = qualifiedUsers;
    }

    return results;
  },
});

export const retention = query({
  args: {
    event: v.string(),
    period: v.optional(v.union(v.literal("day"), v.literal("week"), v.literal("month"))),
    cohorts: v.optional(v.number()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const period = args.period ?? "week";
    const cohortCount = Math.min(args.cohorts ?? 8, 12);
    const now = Date.now();

    const periodMs =
      period === "day" ? 86400000 : period === "week" ? 604800000 : 2592000000;

    const cohorts: Array<{
      period: number;
      date: string;
      size: number;
      retained: number[];
    }> = [];

    for (let c = 0; c < cohortCount; c++) {
      const cohortStart = now - (cohortCount - c) * periodMs;
      const cohortEnd = cohortStart + periodMs;
      const cohortDate = new Date(cohortStart).toISOString().split("T")[0]!;

      // Find users whose firstSeen is in this cohort period
      const users = await ctx.db
        .query("users")
        .withIndex("by_firstSeen", (q) =>
          q.gte("firstSeen", cohortStart).lte("firstSeen", cohortEnd),
        )
        .take(5000);

      const filteredUsers = args.projectId
        ? users.filter((u) => u.projectIds.includes(args.projectId!))
        : users;
      const cohortSize = filteredUsers.length;

      // Check return in subsequent periods
      const retained: number[] = [];
      for (let p = 1; p <= cohortCount - c; p++) {
        const periodStart = cohortStart + p * periodMs;
        const periodEnd = periodStart + periodMs;

        let returnedCount = 0;
        for (const user of filteredUsers) {
          if (user.lastSeen >= periodStart && user.lastSeen < periodEnd) {
            returnedCount++;
          }
        }
        retained.push(cohortSize > 0 ? returnedCount / cohortSize : 0);
      }

      cohorts.push({ period: c, date: cohortDate, size: cohortSize, retained });
    }

    return { cohorts };
  },
});

export const breakdown = query({
  args: {
    name: v.string(),
    dimension: v.string(),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    projectId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100);

    // Try to use rollups first (pre-aggregated dimensions)
    const rollups = await ctx.db
      .query("daily_rollups")
      .withIndex("by_name_date", (q) => q.eq("name", args.name))
      .collect();

    const fromDate = args.from ? new Date(args.from).toISOString().split("T")[0]! : null;
    const toDate = args.to ? new Date(args.to).toISOString().split("T")[0]! : null;

    const counts = new Map<string, number>();
    let total = 0;

    for (const r of rollups) {
      if (fromDate && r.date < fromDate) continue;
      if (toDate && r.date > toDate) continue;
      if (args.projectId && r.projectId !== args.projectId) continue;

      const dims = r.dimensions as Record<string, Record<string, number>> | null;
      const dimData = dims?.[args.dimension];
      if (dimData) {
        for (const [value, count] of Object.entries(dimData)) {
          counts.set(value, (counts.get(value) ?? 0) + count);
          total += count;
        }
      }
    }

    const result = [...counts.entries()]
      .map(([value, count]) => ({
        value,
        count,
        percentage: total > 0 ? count / total : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return result;
  },
});

export const attribution = query({
  args: {
    conversionEvent: v.string(),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const from = args.from ?? now - 30 * 86400000;
    const to = args.to ?? now;

    // Find users who fired the conversion event
    const conversionEvents = await ctx.db
      .query("events")
      .withIndex("by_name_time", (q) =>
        q.eq("name", args.conversionEvent).gte("timestamp", from).lte("timestamp", to),
      )
      .take(5000);

    const convertedUserIds = [...new Set(conversionEvents.map((e) => e.userId))];

    // Get first session for each converting user (attribution source)
    const sources = new Map<string, { conversions: number }>();
    for (const userId of convertedUserIds) {
      const firstSession = await ctx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();

      if (!firstSession) continue;
      if (args.projectId && firstSession.projectId !== args.projectId) continue;

      const source = firstSession.referrer || "direct";
      const existing = sources.get(source) ?? { conversions: 0 };
      existing.conversions++;
      sources.set(source, existing);
    }

    const totalConversions = convertedUserIds.length;
    return [...sources.entries()]
      .map(([source, data]) => ({
        source,
        conversions: data.conversions,
        rate: totalConversions > 0 ? data.conversions / totalConversions : 0,
      }))
      .sort((a, b) => b.conversions - a.conversions);
  },
});

export const userTimeline = query({
  args: {
    userId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);

    const user = await ctx.db
      .query("users")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.userId))
      .unique();

    const events = await ctx.db
      .query("events")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);

    return { user, events, sessions };
  },
});

export const sessionDetail = query({
  args: {
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    const events = await ctx.db
      .query("events")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    // Sort by seqNum for ordered replay
    events.sort((a, b) => a.seqNum - b.seqNum);

    return { session, events };
  },
});

export const live = query({
  args: {
    limit: v.optional(v.number()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 200);

    const events = await ctx.db
      .query("events")
      .order("desc")
      .take(limit);

    if (args.projectId) {
      return events.filter((e) => e.projectId === args.projectId);
    }
    return events;
  },
});

export const search = query({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100);
    const prefix = args.query.toLowerCase();

    const schemas = await ctx.db.query("event_schemas").collect();
    const rollups = await ctx.db.query("daily_rollups").collect();

    const names = new Set<string>();
    for (const s of schemas) names.add(s.name);
    for (const r of rollups) names.add(r.name);

    const matching = [...names]
      .filter((n) => n.toLowerCase().startsWith(prefix))
      .slice(0, limit);

    const result: Array<{ name: string; count: number }> = [];
    for (const name of matching) {
      const c = await counter.count(ctx, name);
      result.push({ name, count: c });
    }

    return result.sort((a, b) => b.count - a.count);
  },
});

export const uniques = query({
  args: {
    period: v.union(v.literal("day"), v.literal("week"), v.literal("month")),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const to = args.to ?? now;
    const from = args.from ?? to - 30 * 86400000;

    const fromDate = new Date(from).toISOString().split("T")[0]!;
    const toDate = new Date(to).toISOString().split("T")[0]!;

    const rollups = await ctx.db
      .query("daily_rollups")
      .withIndex("by_date", (q) => q.gte("date", fromDate).lte("date", toDate))
      .collect();

    const filtered = args.projectId
      ? rollups.filter((r) => r.projectId === args.projectId)
      : rollups;

    // DAU = average daily uniques
    const dailyUniques = new Map<string, number>();
    for (const r of filtered) {
      dailyUniques.set(r.date, (dailyUniques.get(r.date) ?? 0) + r.uniqueUsers);
    }

    const days = [...dailyUniques.values()];
    const dau = days.length > 0 ? days.reduce((a, b) => a + b, 0) / days.length : 0;

    // WAU/MAU approximated from rollup data
    const dayCount = dailyUniques.size || 1;
    const wau = dau * Math.min(7, dayCount);
    const mau = dau * Math.min(30, dayCount);

    const trend = [...dailyUniques.entries()]
      .map(([date, uniques]) => ({ date, uniques }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { dau: Math.round(dau), wau: Math.round(wau), mau: Math.round(mau), trend };
  },
});

export const lifecycle = query({
  args: {
    period: v.optional(v.union(v.literal("day"), v.literal("week"), v.literal("month"))),
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const period = args.period ?? "week";
    const now = Date.now();
    const periodMs =
      period === "day" ? 86400000 : period === "week" ? 604800000 : 2592000000;
    const from = args.from ?? now - periodMs;
    const to = args.to ?? now;
    const previousFrom = from - periodMs;

    const users = await ctx.db
      .query("users")
      .withIndex("by_lastSeen")
      .take(10000);

    const filtered = args.projectId
      ? users.filter((u) => u.projectIds.includes(args.projectId!))
      : users;

    let newCount = 0;
    let returningCount = 0;
    let dormantCount = 0;
    let resurrectedCount = 0;

    for (const user of filtered) {
      const seenInPeriod = user.lastSeen >= from && user.lastSeen <= to;
      const firstSeenInPeriod = user.firstSeen >= from && user.firstSeen <= to;
      const seenInPrevious = user.lastSeen >= previousFrom && user.lastSeen < from;
      const dormantBeforePeriod = user.lastSeen < previousFrom;

      if (firstSeenInPeriod) {
        newCount++;
      } else if (seenInPeriod && seenInPrevious) {
        returningCount++;
      } else if (seenInPeriod && dormantBeforePeriod) {
        resurrectedCount++;
      } else if (!seenInPeriod) {
        dormantCount++;
      } else {
        returningCount++;
      }
    }

    return {
      new: newCount,
      returning: returningCount,
      dormant: dormantCount,
      resurrected: resurrectedCount,
      total: filtered.length,
    };
  },
});

export const stickiness = query({
  args: {
    from: v.optional(v.number()),
    to: v.optional(v.number()),
    projectId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const from = args.from ?? now - 30 * 86400000;
    const to = args.to ?? now;
    const fromDate = new Date(from).toISOString().split("T")[0]!;
    const toDate = new Date(to).toISOString().split("T")[0]!;

    const rollups = await ctx.db
      .query("daily_rollups")
      .withIndex("by_date", (q) => q.gte("date", fromDate).lte("date", toDate))
      .collect();

    const filtered = args.projectId
      ? rollups.filter((r) => r.projectId === args.projectId)
      : rollups;

    const dailyUniques = new Map<string, number>();
    for (const r of filtered) {
      dailyUniques.set(r.date, (dailyUniques.get(r.date) ?? 0) + r.uniqueUsers);
    }

    const days = [...dailyUniques.values()];
    const avgDau = days.length > 0 ? days.reduce((a, b) => a + b, 0) / days.length : 0;
    const totalUniques = filtered.reduce((sum, r) => sum + r.uniqueUsers, 0);
    const estimatedMau = totalUniques > 0 ? totalUniques / (filtered.length || 1) * 30 : 0;
    const ratio = estimatedMau > 0 ? avgDau / estimatedMau : 0;

    const trend = [...dailyUniques.entries()]
      .map(([date, dau]) => ({
        date,
        dau,
        mau: Math.round(estimatedMau),
        ratio: estimatedMau > 0 ? dau / estimatedMau : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { ratio: Math.round(ratio * 100) / 100, trend };
  },
});

function parseWindow(window: string): number {
  const match = window.match(/^(\d+)(d|h|m)$/);
  if (!match) return 7 * 86400000;
  const num = parseInt(match[1]!, 10);
  const unit = match[2];
  if (unit === "d") return num * 86400000;
  if (unit === "h") return num * 3600000;
  if (unit === "m") return num * 60000;
  return 7 * 86400000;
}
