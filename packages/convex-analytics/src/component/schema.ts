import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  events: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    name: v.string(),
    projectId: v.string(),
    env: v.string(),
    platform: v.string(),
    properties: v.any(),
    timestamp: v.number(),
    path: v.string(),
    locale: v.string(),
    referrer: v.string(),
    device: v.string(),
    browser: v.string(),
    os: v.string(),
    country: v.string(),
    region: v.optional(v.string()),
    city: v.optional(v.string()),
    utmSource: v.optional(v.string()),
    utmMedium: v.optional(v.string()),
    utmCampaign: v.optional(v.string()),
    seqNum: v.number(),
  })
    .index("by_name_time", ["name", "timestamp"])
    .index("by_user_time", ["userId", "timestamp"])
    .index("by_session", ["sessionId", "timestamp"])
    .index("by_name_path", ["name", "path", "timestamp"])
    .index("by_name_locale", ["name", "locale", "timestamp"])
    .index("by_name_device", ["name", "device", "timestamp"])
    .index("by_name_referrer", ["name", "referrer", "timestamp"])
    .index("by_name_country", ["name", "country", "timestamp"])
    .index("by_name_browser", ["name", "browser", "timestamp"])
    .index("by_name_os", ["name", "os", "timestamp"])
    .index("by_project_name", ["projectId", "name", "timestamp"])
    .index("by_project_env", ["projectId", "env", "timestamp"]),

  sessions: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    projectId: v.string(),
    env: v.string(),
    platform: v.string(),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    eventCount: v.number(),
    entryPath: v.string(),
    exitPath: v.string(),
    referrer: v.string(),
    device: v.string(),
    browser: v.string(),
    os: v.string(),
    locale: v.string(),
    country: v.string(),
    duration: v.optional(v.number()),
  })
    .index("by_user", ["userId", "startTime"])
    .index("by_time", ["startTime"])
    .index("by_session", ["sessionId"]),

  users: defineTable({
    visitorId: v.string(),
    projectIds: v.array(v.string()),
    firstSeen: v.number(),
    lastSeen: v.number(),
    sessionCount: v.number(),
    totalEvents: v.number(),
    device: v.string(),
    browser: v.string(),
    os: v.string(),
    locale: v.string(),
    country: v.string(),
  })
    .index("by_visitor", ["visitorId"])
    .index("by_firstSeen", ["firstSeen"])
    .index("by_lastSeen", ["lastSeen"]),

  daily_rollups: defineTable({
    name: v.string(),
    projectId: v.string(),
    env: v.string(),
    date: v.string(),
    count: v.number(),
    uniqueUsers: v.number(),
    dimensions: v.any(),
  })
    .index("by_name_date", ["name", "date"])
    .index("by_project_date", ["projectId", "name", "date"])
    .index("by_date", ["date"]),

  event_schemas: defineTable({
    name: v.string(),
    allowedProperties: v.any(),
  }).index("by_name", ["name"]),

  config: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),

  archives: defineTable({
    date: v.string(),
    fileId: v.id("_storage"),
    eventCount: v.number(),
    sizeBytes: v.number(),
  }).index("by_date", ["date"]),
});
