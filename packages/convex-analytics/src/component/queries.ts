import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { ShardedCounter } from "@convex-dev/sharded-counter";

const counter = new ShardedCounter(components.shardedCounter, {
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
