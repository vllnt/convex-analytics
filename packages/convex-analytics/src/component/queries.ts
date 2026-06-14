import { query } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { ShardedCounter } from "@convex-dev/sharded-counter";
import {
  rangeValidator,
  whereValidator,
  granularityValidator,
  topRow,
  timeseriesPoint,
  uniquesView,
  funnelStep,
  retentionCohort,
  eventPage,
} from "./validators.js";
import { bucketStart, bucketSize, valKey } from "../shared.js";
import type { Granularity } from "../shared.js";

const counter = new ShardedCounter(components.shardedCounter as never, {
  defaultShards: 16,
});

const TOTAL = "";

/** Total event count over a range, optionally filtered by one dimension value. */
export const metric = query({
  args: {
    scope: v.string(),
    name: v.string(),
    range: v.optional(rangeValidator),
    where: v.optional(whereValidator),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const dim = args.where ? args.where.dim : TOTAL;
    const val = args.where ? valKey(args.where.val) : TOTAL;

    if (!args.range && !args.where) {
      return await counter.count(ctx, `${args.scope}:${args.name}`);
    }

    const rollups = await ctx.db
      .query("rollups")
      .withIndex("by_scope_name_gran_bucket_dim", (q) =>
        q
          .eq("scope", args.scope)
          .eq("name", args.name)
          .eq("granularity", "day"),
      )
      .collect();

    let total = 0;
    for (const r of rollups) {
      if (r.dim !== dim || r.val !== val) continue;
      if (args.range?.from !== undefined && r.bucket < bucketStart(args.range.from, "day")) {
        continue;
      }
      if (args.range?.to !== undefined && r.bucket > bucketStart(args.range.to, "day")) {
        continue;
      }
      total += r.count;
    }
    return total;
  },
});

/** Top values of a dimension (breakdown), ranked by count. */
export const top = query({
  args: {
    scope: v.string(),
    name: v.string(),
    dimension: v.string(),
    range: v.optional(rangeValidator),
    limit: v.optional(v.number()),
  },
  returns: v.array(topRow),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 20, 100);
    const rollups = await ctx.db
      .query("rollups")
      .withIndex("by_scope_name_gran_bucket_dim", (q) =>
        q
          .eq("scope", args.scope)
          .eq("name", args.name)
          .eq("granularity", "day"),
      )
      .collect();

    const counts = new Map<string, number>();
    for (const r of rollups) {
      if (r.dim !== args.dimension) continue;
      if (args.range?.from !== undefined && r.bucket < bucketStart(args.range.from, "day")) {
        continue;
      }
      if (args.range?.to !== undefined && r.bucket > bucketStart(args.range.to, "day")) {
        continue;
      }
      counts.set(r.val, (counts.get(r.val) ?? 0) + r.count);
    }

    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  },
});

/** Bucketed counts over a range, optionally filtered by one dimension value. */
export const timeseries = query({
  args: {
    scope: v.string(),
    name: v.string(),
    granularity: granularityValidator,
    range: rangeValidator,
    where: v.optional(whereValidator),
  },
  returns: v.array(timeseriesPoint),
  handler: async (ctx, args) => {
    const gran: Granularity = args.granularity;
    const dim = args.where ? args.where.dim : TOTAL;
    const val = args.where ? valKey(args.where.val) : TOTAL;

    const rollups = await ctx.db
      .query("rollups")
      .withIndex("by_scope_name_gran_bucket_dim", (q) =>
        q.eq("scope", args.scope).eq("name", args.name).eq("granularity", gran),
      )
      .collect();

    const fromBucket =
      args.range.from !== undefined ? bucketStart(args.range.from, gran) : undefined;
    const toBucket =
      args.range.to !== undefined ? bucketStart(args.range.to, gran) : undefined;

    const counts = new Map<number, number>();
    for (const r of rollups) {
      if (r.dim !== dim || r.val !== val) continue;
      if (fromBucket !== undefined && r.bucket < fromBucket) continue;
      if (toBucket !== undefined && r.bucket > toBucket) continue;
      counts.set(r.bucket, (counts.get(r.bucket) ?? 0) + r.count);
    }

    return [...counts.entries()]
      .map(([bucket, count]) => ({ bucket, count }))
      .sort((a, b) => a.bucket - b.bucket);
  },
});

/** DAU/WAU/MAU distinct-subject counts from the subjects table. */
export const uniques = query({
  args: {
    scope: v.string(),
    range: rangeValidator,
    granularity: granularityValidator,
  },
  returns: uniquesView,
  handler: async (ctx, args) => {
    const now = Date.now();
    const to = args.range.to ?? now;
    const from = args.range.from ?? to - 30 * 24 * 60 * 60 * 1000;

    const subjects = await ctx.db
      .query("subjects")
      .withIndex("by_scope_firstSeen", (q) => q.eq("scope", args.scope))
      .collect();

    const size = bucketSize(args.granularity);
    const trendBuckets = new Map<number, Set<string>>();
    let mau = 0;
    let wau = 0;
    const dayMs = 24 * 60 * 60 * 1000;
    const wauCutoff = to - 7 * dayMs;
    const mauCutoff = to - 30 * dayMs;

    for (const s of subjects) {
      if (s.lastSeen < from || s.lastSeen > to) continue;
      mau += s.lastSeen >= mauCutoff ? 1 : 0;
      wau += s.lastSeen >= wauCutoff ? 1 : 0;
      const bucket = Math.floor(s.lastSeen / size) * size;
      const set = trendBuckets.get(bucket) ?? new Set<string>();
      set.add(s.subjectRef);
      trendBuckets.set(bucket, set);
    }

    const trend = [...trendBuckets.entries()]
      .map(([bucket, set]) => ({ bucket, uniques: set.size }))
      .sort((a, b) => a.bucket - b.bucket);

    const dau =
      trend.length > 0
        ? Math.round(trend.reduce((sum, p) => sum + p.uniques, 0) / trend.length)
        : 0;

    return { dau, wau, mau, trend };
  },
});

/** Ordered step conversion over raw events, keyed by subjectRef. */
export const funnel = query({
  args: {
    scope: v.string(),
    steps: v.array(v.string()),
    range: rangeValidator,
  },
  returns: v.array(funnelStep),
  handler: async (ctx, args) => {
    if (args.steps.length < 2) {
      throw new Error("Funnel requires at least 2 steps");
    }
    const now = Date.now();
    const to = args.range.to ?? now;
    const from = args.range.from ?? to - 30 * 24 * 60 * 60 * 1000;

    const stepSubjects = await Promise.all(
      args.steps.map(async (step) => {
        const events = await ctx.db
          .query("events")
          .withIndex("by_scope_name_ts", (q) =>
            q.eq("scope", args.scope).eq("name", step).gte("ts", from).lte("ts", to),
          )
          .take(10000);
        const firstTs = new Map<string, number>();
        for (const e of events) {
          if (e.subjectRef === undefined) continue;
          const prev = firstTs.get(e.subjectRef);
          if (prev === undefined || e.ts < prev) {
            firstTs.set(e.subjectRef, e.ts);
          }
        }
        return firstTs;
      }),
    );

    const results: Array<{ name: string; count: number; rate: number }> = [];
    let qualified = new Set(stepSubjects[0]!.keys());
    let firstCount = qualified.size;
    results.push({ name: args.steps[0]!, count: firstCount, rate: 1 });

    for (let i = 1; i < args.steps.length; i++) {
      const prevTimes = stepSubjects[i - 1]!;
      const thisTimes = stepSubjects[i]!;
      const next = new Set<string>();
      for (const subject of qualified) {
        const prevTs = prevTimes.get(subject);
        const thisTs = thisTimes.get(subject);
        if (prevTs !== undefined && thisTs !== undefined && thisTs >= prevTs) {
          next.add(subject);
        }
      }
      results.push({
        name: args.steps[i]!,
        count: next.size,
        rate: firstCount > 0 ? next.size / firstCount : 0,
      });
      qualified = next;
    }

    return results;
  },
});

/** Cohort return rates by first-seen period. */
export const retention = query({
  args: {
    scope: v.string(),
    cohortRange: rangeValidator,
    periods: v.number(),
    granularity: v.optional(granularityValidator),
  },
  returns: v.array(retentionCohort),
  handler: async (ctx, args) => {
    const gran: Granularity = args.granularity ?? "day";
    const size = bucketSize(gran);
    const now = Date.now();
    const to = args.cohortRange.to ?? now;
    const from = args.cohortRange.from ?? to - args.periods * size;
    const periods = Math.min(args.periods, 30);

    const subjects = await ctx.db
      .query("subjects")
      .withIndex("by_scope_firstSeen", (q) =>
        q.eq("scope", args.scope).gte("firstSeen", from).lte("firstSeen", to),
      )
      .take(10000);

    const cohortMap = new Map<
      number,
      Array<{ firstSeen: number; lastSeen: number }>
    >();
    for (const s of subjects) {
      const cohort = Math.floor(s.firstSeen / size) * size;
      const list = cohortMap.get(cohort) ?? [];
      list.push({ firstSeen: s.firstSeen, lastSeen: s.lastSeen });
      cohortMap.set(cohort, list);
    }

    return [...cohortMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([cohort, members]) => {
        const retained: number[] = [];
        for (let p = 1; p <= periods; p++) {
          const periodStart = cohort + p * size;
          const periodEnd = periodStart + size;
          let count = 0;
          for (const m of members) {
            if (m.lastSeen >= periodStart && m.lastSeen < periodEnd) count++;
          }
          retained.push(count / members.length);
        }
        return { cohort, size: members.length, retained };
      });
  },
});

/** Paginated raw events for an event name, newest first. */
export const list = query({
  args: {
    scope: v.string(),
    name: v.string(),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  returns: eventPage,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("events")
      .withIndex("by_scope_name_ts", (q) =>
        q.eq("scope", args.scope).eq("name", args.name),
      )
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      page: result.page.map((e) => ({
        _id: e._id as string,
        _creationTime: e._creationTime,
        scope: e.scope,
        name: e.name,
        subjectRef: e.subjectRef,
        sessionRef: e.sessionRef,
        props: e.props,
        ts: e.ts,
        seq: e.seq,
        dedupeKey: e.dedupeKey,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Read a single config value for a scope. */
export const configGet = query({
  args: { scope: v.string(), key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("config")
      .withIndex("by_scope_key", (q) =>
        q.eq("scope", args.scope).eq("key", args.key),
      )
      .unique();
    return entry?.value ?? null;
  },
});
