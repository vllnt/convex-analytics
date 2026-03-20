import { v } from "convex/values";

export const trackArgs = {
  userId: v.string(),
  sessionId: v.string(),
  name: v.string(),
  projectId: v.optional(v.string()),
  env: v.optional(v.string()),
  platform: v.optional(v.string()),
  properties: v.optional(v.any()),
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
};

export const scopingArgs = {
  projectId: v.optional(v.string()),
  env: v.optional(v.string()),
  platform: v.optional(v.string()),
};

export const timeRangeArgs = {
  from: v.optional(v.number()),
  to: v.optional(v.number()),
};

export const paginationArgs = {
  limit: v.optional(v.number()),
  cursor: v.optional(v.string()),
};
