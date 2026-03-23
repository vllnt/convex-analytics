import { mutation } from "./_generated/server";
import { components } from "./_generated/api";
import { v } from "convex/values";
import { DirectAggregate } from "@convex-dev/aggregate";
import { ShardedCounter } from "@convex-dev/sharded-counter";
import { RateLimiter, MINUTE } from "@convex-dev/rate-limiter";
import { propertiesValidator, traitsValidator, configEntriesValidator, allowedPropertiesValidator } from "./validators.js";

type AggregateType = { Key: string; Id: string; Namespace: string };
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

const EVENT_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

export const track = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    name: v.string(),
    projectId: v.optional(v.string()),
    env: v.optional(v.string()),
    platform: v.optional(v.string()),
    properties: v.optional(propertiesValidator),
    timestamp: v.optional(v.number()),
    path: v.optional(v.string()),
    locale: v.optional(v.string()),
    referrer: v.optional(v.string()),
    device: v.optional(v.string()),
    browser: v.optional(v.string()),
    os: v.optional(v.string()),
    country: v.optional(v.string()),
    region: v.optional(v.string()),
    city: v.optional(v.string()),
    utmSource: v.optional(v.string()),
    utmMedium: v.optional(v.string()),
    utmCampaign: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // H6: Validate event name format
    if (!EVENT_NAME_RE.test(args.name)) {
      throw new Error(
        `Invalid event name "${args.name}". Must match /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/`,
      );
    }

    const now = Date.now();
    const projectId = args.projectId ?? "default";
    const env = args.env ?? "default";
    const platform = args.platform ?? "default";
    const timestamp = args.timestamp ?? now;
    const path = args.path ?? "unknown";
    const locale = args.locale ?? "unknown";
    const referrer = args.referrer ?? "";
    const device = args.device ?? "unknown";
    const browser = args.browser ?? "unknown";
    const os = args.os ?? "unknown";
    const country = args.country ?? "unknown";

    // 1. Rate limit check (per sessionId)
    const rateLimitResult = await rateLimiter.limit(ctx, "trackEvent", {
      key: args.sessionId,
    });
    if (!rateLimitResult.ok) {
      return null;
    }

    // 2. Validate + filter properties against schema (if registered)
    let properties = args.properties ?? {};
    const eventSchema = await ctx.db
      .query("event_schemas")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    if (eventSchema) {
      const allowed = eventSchema.allowedProperties as Record<string, string>;
      const filtered: Record<string, unknown> = {};
      const raw = properties as Record<string, unknown>;
      for (const key of Object.keys(raw)) {
        if (!(key in allowed)) continue;
        const expectedType = allowed[key];
        const value = raw[key];
        // H8/M2: Validate value types match declared schema
        if (expectedType === "string" && typeof value === "string") {
          filtered[key] = value;
        } else if (expectedType === "number" && typeof value === "number") {
          filtered[key] = value;
        } else if (expectedType === "boolean" && typeof value === "boolean") {
          filtered[key] = value;
        }
        // Mismatched type → silently dropped (same as unknown key)
      }
      properties = filtered;
    }

    // 3. Upsert session FIRST (C6: fixes seqNum TOCTOU race)
    const existingSession = await ctx.db
      .query("sessions")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .unique();

    let seqNum: number;
    if (existingSession) {
      seqNum = existingSession.eventCount;
      await ctx.db.patch(existingSession._id, {
        eventCount: existingSession.eventCount + 1,
        exitPath: path,
        endTime: timestamp,
      });
    } else {
      seqNum = 0;
      await ctx.db.insert("sessions", {
        userId: args.userId,
        sessionId: args.sessionId,
        projectId,
        env,
        platform,
        startTime: timestamp,
        endTime: undefined,
        eventCount: 1,
        entryPath: path,
        exitPath: path,
        referrer,
        device,
        browser,
        os,
        locale,
        country,
        duration: undefined,
      });
    }

    // 4. Insert event (seqNum derived from step 3)
    const eventId = await ctx.db.insert("events", {
      userId: args.userId,
      sessionId: args.sessionId,
      name: args.name,
      projectId,
      env,
      platform,
      properties,
      timestamp,
      path,
      locale,
      referrer,
      device,
      browser,
      os,
      country,
      region: args.region,
      city: args.city,
      utmSource: args.utmSource,
      utmMedium: args.utmMedium,
      utmCampaign: args.utmCampaign,
      seqNum,
    });

    // 5. Upsert user
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.userId))
      .unique();
    if (existingUser) {
      const projectIds = existingUser.projectIds.includes(projectId)
        ? existingUser.projectIds
        : [...existingUser.projectIds, projectId];
      await ctx.db.patch(existingUser._id, {
        lastSeen: timestamp,
        totalEvents: existingUser.totalEvents + 1,
        sessionCount: existingSession
          ? existingUser.sessionCount
          : existingUser.sessionCount + 1,
        device,
        browser,
        os,
        locale,
        country,
        projectIds,
      });
    } else {
      await ctx.db.insert("users", {
        visitorId: args.userId,
        projectIds: [projectId],
        firstSeen: timestamp,
        lastSeen: timestamp,
        sessionCount: 1,
        totalEvents: 1,
        device,
        browser,
        os,
        locale,
        country,
      });
    }

    // 6. Aggregate insert with namespace "name:YYYY-MM-DD"
    const dateStr = new Date(timestamp).toISOString().split("T")[0]!;
    const namespace = `${args.name}:${dateStr}`;
    await aggregate.insert(ctx, {
      key: String(timestamp),
      id: eventId as string,
      namespace,
    });

    // 7. Sharded counter increment
    await counter.add(ctx, args.name);

    return null;
  },
});

export const identify = mutation({
  args: {
    userId: v.string(),
    traits: v.optional(traitsValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.userId))
      .unique();
    if (!user) {
      return null;
    }
    const traits = (args.traits ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof traits["device"] === "string") patch["device"] = traits["device"];
    if (typeof traits["browser"] === "string") patch["browser"] = traits["browser"];
    if (typeof traits["os"] === "string") patch["os"] = traits["os"];
    if (typeof traits["locale"] === "string") patch["locale"] = traits["locale"];
    if (typeof traits["country"] === "string") patch["country"] = traits["country"];

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(user._id, patch);
    }
    return null;
  },
});

const ALIAS_BATCH_SIZE = 500;

export const alias = mutation({
  args: {
    anonymousId: v.string(),
    identifiedId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // H4: Self-alias guard
    if (args.anonymousId === args.identifiedId) {
      return null;
    }

    const anonUser = await ctx.db
      .query("users")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.anonymousId))
      .unique();
    if (!anonUser) {
      return null;
    }

    // C5: Paginated reassignment instead of .collect()
    async function fetchUserEvents(
      batchCtx: typeof ctx,
      userId: string,
    ) {
      return batchCtx.db
        .query("events")
        .withIndex("by_user_time", (q) => q.eq("userId", userId))
        .take(ALIAS_BATCH_SIZE);
    }

    async function fetchUserSessions(
      batchCtx: typeof ctx,
      userId: string,
    ) {
      return batchCtx.db
        .query("sessions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(ALIAS_BATCH_SIZE);
    }

    // Reassign events in batches
    let events = await fetchUserEvents(ctx, args.anonymousId);
    while (events.length > 0) {
      for (const event of events) {
        await ctx.db.patch(event._id, { userId: args.identifiedId });
      }
      if (events.length < ALIAS_BATCH_SIZE) break;
      events = await fetchUserEvents(ctx, args.anonymousId);
    }

    // Reassign sessions in batches
    let sessions = await fetchUserSessions(ctx, args.anonymousId);
    while (sessions.length > 0) {
      for (const session of sessions) {
        await ctx.db.patch(session._id, { userId: args.identifiedId });
      }
      if (sessions.length < ALIAS_BATCH_SIZE) break;
      sessions = await fetchUserSessions(ctx, args.anonymousId);
    }

    // Merge user records
    const identifiedUser = await ctx.db
      .query("users")
      .withIndex("by_visitor", (q) => q.eq("visitorId", args.identifiedId))
      .unique();
    if (identifiedUser) {
      const mergedProjectIds = [
        ...new Set([...identifiedUser.projectIds, ...anonUser.projectIds]),
      ];
      await ctx.db.patch(identifiedUser._id, {
        firstSeen: Math.min(identifiedUser.firstSeen, anonUser.firstSeen),
        lastSeen: Math.max(identifiedUser.lastSeen, anonUser.lastSeen),
        totalEvents: identifiedUser.totalEvents + anonUser.totalEvents,
        sessionCount: identifiedUser.sessionCount + anonUser.sessionCount,
        projectIds: mergedProjectIds,
      });
      await ctx.db.delete(anonUser._id);
    } else {
      await ctx.db.patch(anonUser._id, {
        visitorId: args.identifiedId,
      });
    }

    return null;
  },
});

// ─── Config Mutations ────────────────────────────────────────────────────

const MUTABLE_CONFIG_KEYS = new Set([
  "retention_days",
  "rate_limit",
  "session_timeout",
  "alert_threshold",
]);

export const configSet = mutation({
  args: { key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("config", { key: args.key, value: args.value });
    }
    return null;
  },
});

export const configSetMany = mutation({
  args: { entries: configEntriesValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entries = args.entries as Record<string, string>;
    const keys = Object.keys(entries);
    for (const key of keys) {
      if (!MUTABLE_CONFIG_KEYS.has(key)) {
        throw new Error(`Config key '${key}' is not mutable`);
      }
    }

    const existingConfigs = await Promise.all(
      keys.map(async (key) => ({
        key,
        value: entries[key]!,
        existing: await ctx.db
          .query("config")
          .withIndex("by_key", (q) => q.eq("key", key))
          .unique(),
      })),
    );

    for (const { key, value, existing } of existingConfigs) {
      if (existing) {
        await ctx.db.patch(existing._id, { value });
      } else {
        await ctx.db.insert("config", { key, value });
      }
    }
    return null;
  },
});

export const configUpsertSchema = mutation({
  args: {
    name: v.string(),
    allowedProperties: allowedPropertiesValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const props = args.allowedProperties;
    if (typeof props !== "object" || props === null || Array.isArray(props)) {
      throw new Error("allowedProperties must be an object { key: type }");
    }
    for (const [key, val] of Object.entries(props as Record<string, unknown>)) {
      if (typeof key !== "string") {
        throw new Error(`Property key must be a string, got ${typeof key}`);
      }
      if (val !== "string" && val !== "number" && val !== "boolean") {
        throw new Error(
          `Property '${key}' type must be 'string', 'number', or 'boolean', got '${String(val)}'`,
        );
      }
    }

    const existing = await ctx.db
      .query("event_schemas")
      .withIndex("by_name", (q) => q.eq("name", args.name))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        allowedProperties: args.allowedProperties,
      });
    } else {
      await ctx.db.insert("event_schemas", {
        name: args.name,
        allowedProperties: args.allowedProperties,
      });
    }
    return null;
  },
});
