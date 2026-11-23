import { internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";
import type { MutationCtx } from "./_generated/server.js";
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

const SCOPE_SLICE = MAINTENANCE_CAP / SCOPE_BATCH;

const INLINE_BYTES_BUDGET = 4 * 1024 * 1024;

type ScopeWork = { count: number; bytes: number };

function sizeOf(rows: object[]): number {
  return rows.reduce((total, row) => total + new TextEncoder().encode(JSON.stringify(row)).length, 0);
}

async function pruneScope(ctx: MutationCtx, scope: string, limit: number): Promise<ScopeWork> {
  const retentionDays = await readNumber(ctx, scope, "retentionDays", DEFAULT_RETENTION_DAYS);
  const cutoff = Date.now() - retentionDays * DAY_MS;
  const stale = await ctx.db
    .query("events")
    .withIndex("by_scope_ts", (q) => q.eq("scope", scope).lt("ts", cutoff))
    .take(limit);
  await Promise.all(stale.map((event) => ctx.db.delete("events", event._id)));
  return { count: stale.length, bytes: sizeOf(stale) };
}

async function closeScope(ctx: MutationCtx, scope: string, limit: number): Promise<ScopeWork> {
  const idleMs = await readNumber(ctx, scope, "sessionIdleMs", DEFAULT_SESSION_IDLE_MS);
  const cutoff = Date.now() - idleMs;
  const stale = await ctx.db
    .query("sessions")
    .withIndex("by_scope_endTs_lastTs", (q) =>
      q.eq("scope", scope).eq("endTs", undefined).lt("lastTs", cutoff),
    )
    .take(limit);
  await Promise.all(
    stale.map((session) => ctx.db.patch("sessions", session._id, { endTs: session.lastTs })),
  );
  return { count: stale.length, bytes: sizeOf(stale) };
}

type Sweep = "prune" | "closeSessions";

async function sweep(
  ctx: MutationCtx,
  kind: Sweep,
  args: { scope?: string; afterScope?: string },
): Promise<number> {
  const work = kind === "prune" ? pruneScope : closeScope;
  const next = internal.internal_mutations[kind];
  if (args.scope !== undefined) {
    const { count } = await work(ctx, args.scope, MAINTENANCE_CAP);
    if (count === MAINTENANCE_CAP) {
      await ctx.scheduler.runAfter(0, next, { scope: args.scope });
    }
    return count;
  }
  const scopes = await ctx.db
    .query("scopes")
    .withIndex("by_scope", (q) =>
      args.afterScope === undefined ? q : q.gt("scope", args.afterScope),
    )
    .take(SCOPE_BATCH);
  let total = 0;
  let bytes = 0;
  for (const [i, row] of scopes.entries()) {
    const result = await work(ctx, row.scope, SCOPE_SLICE);
    total += result.count;
    bytes += result.bytes;
    if (result.count === SCOPE_SLICE) {
      await ctx.scheduler.runAfter(0, next, { scope: row.scope });
    }
    const more = i < scopes.length - 1 || scopes.length === SCOPE_BATCH;
    if (more && (bytes >= INLINE_BYTES_BUDGET || i === scopes.length - 1)) {
      await ctx.scheduler.runAfter(0, next, { afterScope: row.scope });
      return total;
    }
  }
  return total;
}

/** Delete raw events past `retentionDays` for a scope. Rollups are kept forever. Idempotent. */
export const prune = internalMutation({
  args: { scope: v.optional(v.string()), afterScope: v.optional(v.string()) },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => ({ deleted: await sweep(ctx, "prune", args) }),
});

/** Close sessions idle past `sessionIdleMs` (set `endTs`). Idempotent. */
export const closeSessions = internalMutation({
  args: { scope: v.optional(v.string()), afterScope: v.optional(v.string()) },
  returns: v.object({ closed: v.number() }),
  handler: async (ctx, args) => ({ closed: await sweep(ctx, "closeSessions", args) }),
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
      .withIndex("by_scope_name_gran_dim_val_bucket", (q) =>
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
          if (Object.hasOwn(e.props, dim)) {
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
