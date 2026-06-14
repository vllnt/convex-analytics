import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { bucketStart, valKey } from "../shared.js";
import type { Granularity } from "../shared.js";

const PRUNE_CAP = 10000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;
const TOTAL = "";

/** Read a numeric config value for a scope, falling back to a default. */
async function readNumber(
  ctx: MutationCtx,
  scope: string,
  key: string,
  fallback: number,
): Promise<number> {
  const entry = await ctx.db
    .query("config")
    .withIndex("by_scope_key", (q) => q.eq("scope", scope).eq("key", key))
    .unique();
  if (!entry) return fallback;
  const n = Number(entry.value);
  return Number.isFinite(n) ? n : fallback;
}

/** List every scope that has at least one config row (the scopes a cron should sweep). */
async function configuredScopes(ctx: MutationCtx): Promise<string[]> {
  const rows = await ctx.db.query("config").collect();
  return [...new Set(rows.map((r) => r.scope))];
}

/** Delete raw events past `retentionDays` for a scope. Rollups are kept forever. Idempotent. */
export const prune = internalMutation({
  args: { scope: v.optional(v.string()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const scopes = args.scope !== undefined ? [args.scope] : await configuredScopes(ctx);

    const pruneScope = async (scope: string): Promise<number> => {
      const retentionDays = await readNumber(
        ctx,
        scope,
        "retentionDays",
        DEFAULT_RETENTION_DAYS,
      );
      const cutoff = Date.now() - retentionDays * DAY_MS;
      const oldest = await ctx.db
        .query("events")
        .withIndex("by_scope_name_ts", (q) => q.eq("scope", scope))
        .order("asc")
        .take(PRUNE_CAP);
      const toDelete = oldest.filter((e) => e.ts < cutoff);
      await Promise.all(toDelete.map((e) => ctx.db.delete(e._id)));
      return toDelete.length;
    };

    const counts = await Promise.all(scopes.map(pruneScope));
    return { deleted: counts.reduce((a, b) => a + b, 0) };
  },
});

/** Close sessions idle past `sessionIdleMs` (set `endTs`). Idempotent. */
export const closeSessions = internalMutation({
  args: { scope: v.optional(v.string()) },
  returns: v.object({ closed: v.number() }),
  handler: async (ctx, args) => {
    const scopes = args.scope !== undefined ? [args.scope] : await configuredScopes(ctx);

    const closeScope = async (scope: string): Promise<number> => {
      const idleMs = await readNumber(
        ctx,
        scope,
        "sessionIdleMs",
        DEFAULT_SESSION_IDLE_MS,
      );
      const cutoff = Date.now() - idleMs;
      const open = await ctx.db
        .query("sessions")
        .withIndex("by_scope_lastTs", (q) => q.eq("scope", scope).lt("lastTs", cutoff))
        .take(1000);
      const stale = open.filter((s) => s.endTs === undefined);
      await Promise.all(stale.map((s) => ctx.db.patch(s._id, { endTs: s.lastTs })));
      return stale.length;
    };

    const counts = await Promise.all(scopes.map(closeScope));
    return { closed: counts.reduce((a, b) => a + b, 0) };
  },
});

/**
 * Re-derive rollups from raw events for a `(scope, name)`. Idempotent: deletes
 * existing rollup rows for the name, then recomputes from the retained raw events.
 */
export const backfill = internalMutation({
  args: {
    scope: v.string(),
    name: v.string(),
    dimensions: v.array(v.string()),
    granularities: v.array(v.union(v.literal("hour"), v.literal("day"))),
  },
  returns: v.object({ events: v.number(), rows: v.number() }),
  handler: async (ctx, args) => {
    const grans = args.granularities.length > 0 ? args.granularities : (["day"] as const);

    const existing = await ctx.db
      .query("rollups")
      .withIndex("by_scope_name_dim_val", (q) =>
        q.eq("scope", args.scope).eq("name", args.name),
      )
      .collect();
    await Promise.all(existing.map((r) => ctx.db.delete(r._id)));

    const events = await ctx.db
      .query("events")
      .withIndex("by_scope_name_ts", (q) =>
        q.eq("scope", args.scope).eq("name", args.name),
      )
      .take(50000);

    const counts = new Map<string, number>();
    const meta = new Map<
      string,
      { gran: Granularity; bucket: number; dim: string; val: string }
    >();
    const bump = (gran: Granularity, bucket: number, dim: string, val: string): void => {
      const k = `${gran}|${bucket}|${dim}|${val}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      if (!meta.has(k)) meta.set(k, { gran, bucket, dim, val });
    };

    for (const e of events) {
      for (const gran of grans) {
        const bucket = bucketStart(e.ts, gran);
        bump(gran, bucket, TOTAL, TOTAL);
        for (const dim of args.dimensions) {
          if (dim in e.props) {
            bump(gran, bucket, dim, valKey(e.props[dim]!));
          }
        }
      }
    }

    await Promise.all(
      [...counts].map(([k, count]) => {
        const m = meta.get(k)!;
        return ctx.db.insert("rollups", {
          scope: args.scope,
          name: args.name,
          granularity: m.gran,
          bucket: m.bucket,
          dim: m.dim,
          val: m.val,
          count,
        });
      }),
    );

    return { events: events.length, rows: counts.size };
  },
});
