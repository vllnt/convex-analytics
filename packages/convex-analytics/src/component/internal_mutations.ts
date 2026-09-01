import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { granularitiesValidator } from "./validators.js";
import { bucketStart, valKey } from "../shared.js";
import type { Granularity } from "../shared.js";

const MAINTENANCE_CAP = 500;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;
const TOTAL = "";

export function guardBackfillSize(eventCount: number): void {
  if (eventCount > 50000) {
    throw new Error("backfill requires at most 50000 retained events; existing rollups were preserved");
  }
}

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

const SCOPE_BATCH = 100;

/** Delete raw events past `retentionDays` for a scope. Rollups are kept forever. Idempotent. */
export const prune = internalMutation({
  args: { scope: v.optional(v.string()), afterScope: v.optional(v.string()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    if (args.scope === undefined) {
      const scopes = await ctx.db
        .query("scopes")
        .withIndex("by_scope", (q) =>
          args.afterScope === undefined ? q : q.gt("scope", args.afterScope),
        )
        .take(SCOPE_BATCH);
      await Promise.all(
        scopes.map((row) =>
          ctx.scheduler.runAfter(0, internal.internal_mutations.prune, {
            scope: row.scope,
          }),
        ),
      );
      if (scopes.length === SCOPE_BATCH) {
        await ctx.scheduler.runAfter(0, internal.internal_mutations.prune, {
          afterScope: scopes[scopes.length - 1]!.scope,
        });
      }
      return { deleted: 0 };
    }

    const retentionDays = await readNumber(
      ctx,
      args.scope,
      "retentionDays",
      DEFAULT_RETENTION_DAYS,
    );
    const cutoff = Date.now() - retentionDays * DAY_MS;
    const stale = await ctx.db
      .query("events")
      .withIndex("by_scope_ts", (q) => q.eq("scope", args.scope!).lt("ts", cutoff))
      .take(MAINTENANCE_CAP);
    await Promise.all(stale.map((event) => ctx.db.delete("events", event._id)));
    if (stale.length === MAINTENANCE_CAP) {
      await ctx.scheduler.runAfter(0, internal.internal_mutations.prune, {
        scope: args.scope,
      });
    }
    return { deleted: stale.length };
  },
});

/** Close sessions idle past `sessionIdleMs` (set `endTs`). Idempotent. */
export const closeSessions = internalMutation({
  args: { scope: v.optional(v.string()), afterScope: v.optional(v.string()) },
  returns: v.object({ closed: v.number() }),
  handler: async (ctx, args) => {
    if (args.scope === undefined) {
      const scopes = await ctx.db
        .query("scopes")
        .withIndex("by_scope", (q) =>
          args.afterScope === undefined ? q : q.gt("scope", args.afterScope),
        )
        .take(SCOPE_BATCH);
      await Promise.all(
        scopes.map((row) =>
          ctx.scheduler.runAfter(0, internal.internal_mutations.closeSessions, {
            scope: row.scope,
          }),
        ),
      );
      if (scopes.length === SCOPE_BATCH) {
        await ctx.scheduler.runAfter(0, internal.internal_mutations.closeSessions, {
          afterScope: scopes[scopes.length - 1]!.scope,
        });
      }
      return { closed: 0 };
    }

    const idleMs = await readNumber(
      ctx,
      args.scope,
      "sessionIdleMs",
      DEFAULT_SESSION_IDLE_MS,
    );
    const cutoff = Date.now() - idleMs;
    const stale = await ctx.db
      .query("sessions")
      .withIndex("by_scope_endTs_lastTs", (q) =>
        q.eq("scope", args.scope!).eq("endTs", undefined).lt("lastTs", cutoff),
      )
      .take(MAINTENANCE_CAP);
    await Promise.all(
      stale.map((session) =>
        ctx.db.patch("sessions", session._id, { endTs: session.lastTs }),
      ),
    );
    if (stale.length === MAINTENANCE_CAP) {
      await ctx.scheduler.runAfter(0, internal.internal_mutations.closeSessions, {
        scope: args.scope,
      });
    }
    return { closed: stale.length };
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
    granularities: granularitiesValidator,
  },
  returns: v.object({ events: v.number(), rows: v.number() }),
  handler: async (ctx, args) => {
    const grans = args.granularities.length > 0 ? args.granularities : (["day"] as const);

    const events = await ctx.db
      .query("events")
      .withIndex("by_scope_name_ts", (q) =>
        q.eq("scope", args.scope).eq("name", args.name),
      )
      .take(50001);
    guardBackfillSize(events.length);

    const existing = await ctx.db
      .query("rollups")
      .withIndex("by_scope_name_dim_val", (q) =>
        q.eq("scope", args.scope).eq("name", args.name),
      )
      .collect();
    await Promise.all(existing.map((r) => ctx.db.delete("rollups", r._id)));

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
