import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("config")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return entry?.value ?? null;
  },
});

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("config").collect();
    const result: Record<string, string> = {};
    for (const entry of entries) {
      if (entry.key === "api_keys") {
        const count = JSON.parse(entry.value).length;
        result[entry.key] = `[${count} keys configured]`;
      } else {
        result[entry.key] = entry.value;
      }
    }
    return result;
  },
});

export const set = mutation({
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

const MUTABLE_CONFIG_KEYS = new Set([
  "retention_days",
  "rate_limit",
  "session_timeout",
  "alert_threshold",
]);

export const setMany = mutation({
  args: { entries: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entries = args.entries as Record<string, string>;
    for (const [key, value] of Object.entries(entries)) {
      if (!MUTABLE_CONFIG_KEYS.has(key)) {
        throw new Error(`Config key '${key}' is not mutable`);
      }
      const existing = await ctx.db
        .query("config")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, { value });
      } else {
        await ctx.db.insert("config", { key, value });
      }
    }
    return null;
  },
});

export const listSchemas = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("event_schemas").collect();
  },
});

export const upsertSchema = mutation({
  args: {
    name: v.string(),
    allowedProperties: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // H8: Validate allowedProperties structure
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
