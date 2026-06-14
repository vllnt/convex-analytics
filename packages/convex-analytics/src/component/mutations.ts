import { mutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { DirectAggregate } from "@convex-dev/aggregate";
import { ShardedCounter } from "@convex-dev/sharded-counter";
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { propsValidator } from "./validators.js";
import { bucketStart, valKey } from "../shared.js";
import type { Granularity, Scalar } from "../shared.js";

type AggregateType = { Key: number; Id: string; Namespace: string };
const aggregate = new DirectAggregate<AggregateType>(components.aggregate as never);
const counter = new ShardedCounter(components.shardedCounter as never, {
  defaultShards: 16,
});
const rateLimiter = new RateLimiter(components.rateLimiter as never, {
  trackEvent: {
    kind: "token bucket",
    rate: 100,
    period: MINUTE,
    capacity: 10,
  },
});

const TOTAL = "";

/** Increment one rollup row `(scope,name,gran,bucket,dim,val)` by 1, inserting if absent. */
async function bumpRollup(
  ctx: MutationCtx,
  scope: string,
  name: string,
  granularity: Granularity,
  bucket: number,
  dim: string,
  val: string,
): Promise<void> {
  const existing = await ctx.db
    .query("rollups")
    .withIndex("by_scope_name_gran_bucket_dim", (q) =>
      q
        .eq("scope", scope)
        .eq("name", name)
        .eq("granularity", granularity)
        .eq("bucket", bucket)
        .eq("dim", dim)
        .eq("val", val),
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { count: existing.count + 1 });
  } else {
    await ctx.db.insert("rollups", {
      scope,
      name,
      granularity,
      bucket,
      dim,
      val,
      count: 1,
    });
  }
}

export const track = mutation({
  args: {
    scope: v.string(),
    name: v.string(),
    subjectRef: v.optional(v.string()),
    sessionRef: v.optional(v.string()),
    props: v.optional(propsValidator),
    ts: v.optional(v.number()),
    dedupeKey: v.optional(v.string()),
    dimensions: v.array(v.string()),
    granularities: v.array(v.union(v.literal("hour"), v.literal("day"))),
    sampleRate: v.optional(v.number()),
  },
  returns: v.union(v.literal("tracked"), v.literal("dropped"), v.literal("duplicate")),
  handler: async (ctx, args) => {
    const now = Date.now();
    const scope = args.scope;
    const ts = args.ts ?? now;
    const props: Record<string, Scalar> = args.props ?? {};
    const grans = args.granularities.length > 0 ? args.granularities : (["day"] as const);

    if (args.sessionRef !== undefined) {
      const rl = await rateLimiter.limit(ctx, "trackEvent", { key: args.sessionRef });
      if (!rl.ok) {
        return "dropped";
      }
    }

    const sampleRate = args.sampleRate ?? 1;
    if (sampleRate < 1 && Math.random() >= sampleRate) {
      return "dropped";
    }

    if (args.dedupeKey !== undefined) {
      const dupe = await ctx.db
        .query("events")
        .withIndex("by_dedupe", (q) =>
          q.eq("scope", scope).eq("dedupeKey", args.dedupeKey),
        )
        .first();
      if (dupe) {
        return "duplicate";
      }
    }

    let sessionDoc = null;
    if (args.sessionRef !== undefined) {
      sessionDoc = await ctx.db
        .query("sessions")
        .withIndex("by_scope_session", (q) =>
          q.eq("scope", scope).eq("sessionRef", args.sessionRef!),
        )
        .unique();
    }
    const seq = sessionDoc ? sessionDoc.eventCount : 0;

    const eventId = await ctx.db.insert("events", {
      scope,
      name: args.name,
      subjectRef: args.subjectRef,
      sessionRef: args.sessionRef,
      props,
      ts,
      seq,
      dedupeKey: args.dedupeKey,
    });

    if (args.sessionRef !== undefined) {
      if (sessionDoc) {
        await ctx.db.patch(sessionDoc._id, {
          lastTs: ts,
          eventCount: sessionDoc.eventCount + 1,
          subjectRef: args.subjectRef ?? sessionDoc.subjectRef,
        });
      } else {
        await ctx.db.insert("sessions", {
          scope,
          sessionRef: args.sessionRef,
          subjectRef: args.subjectRef,
          startTs: ts,
          lastTs: ts,
          eventCount: 1,
        });
      }
    }

    if (args.subjectRef !== undefined) {
      const subject = await ctx.db
        .query("subjects")
        .withIndex("by_scope_subject", (q) =>
          q.eq("scope", scope).eq("subjectRef", args.subjectRef!),
        )
        .unique();
      if (subject) {
        await ctx.db.patch(subject._id, {
          lastSeen: ts > subject.lastSeen ? ts : subject.lastSeen,
          firstSeen: ts < subject.firstSeen ? ts : subject.firstSeen,
          eventCount: subject.eventCount + 1,
        });
      } else {
        await ctx.db.insert("subjects", {
          scope,
          subjectRef: args.subjectRef,
          firstSeen: ts,
          lastSeen: ts,
          eventCount: 1,
        });
      }
    }

    for (const granularity of grans) {
      const bucket = bucketStart(ts, granularity);
      await bumpRollup(ctx, scope, args.name, granularity, bucket, TOTAL, TOTAL);
      for (const dim of args.dimensions) {
        if (dim in props) {
          await bumpRollup(
            ctx,
            scope,
            args.name,
            granularity,
            bucket,
            dim,
            valKey(props[dim]!),
          );
        }
      }
    }

    await aggregate.insert(ctx, {
      key: ts,
      id: eventId as string,
      namespace: `${scope}:${args.name}`,
    });
    await counter.add(ctx, `${scope}:${args.name}`);

    return "tracked";
  },
});

/** Insert-or-patch a single `(scope, key)` config row. */
async function upsertConfig(
  ctx: MutationCtx,
  scope: string,
  key: string,
  value: string,
): Promise<void> {
  const existing = await ctx.db
    .query("config")
    .withIndex("by_scope_key", (q) => q.eq("scope", scope).eq("key", key))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { value });
  } else {
    await ctx.db.insert("config", { scope, key, value });
  }
}

export const configSet = mutation({
  args: { scope: v.string(), key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsertConfig(ctx, args.scope, args.key, args.value);
    return null;
  },
});

export const configure = mutation({
  args: {
    scope: v.string(),
    retentionDays: v.optional(v.number()),
    sampleRate: v.optional(v.number()),
    sessionIdleMs: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entries: Array<[string, string]> = [];
    if (args.retentionDays !== undefined) {
      entries.push(["retentionDays", String(args.retentionDays)]);
    }
    if (args.sampleRate !== undefined) {
      entries.push(["sampleRate", String(args.sampleRate)]);
    }
    if (args.sessionIdleMs !== undefined) {
      entries.push(["sessionIdleMs", String(args.sessionIdleMs)]);
    }
    await Promise.all(
      entries.map(([key, value]) => upsertConfig(ctx, args.scope, key, value)),
    );
    return null;
  },
});
