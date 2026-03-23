import { v } from "convex/values";

/** Arbitrary event properties (JSON object). */
export const propertiesValidator = v.any();

/** Pre-aggregated dimension breakdowns in daily_rollups. */
export const dimensionsValidator = v.any();

/** Event schema property type mappings: { key: "string"|"number"|"boolean" }. */
export const allowedPropertiesValidator = v.any();

/** identify() traits object. */
export const traitsValidator = v.any();

/** configSetMany entries object. */
export const configEntriesValidator = v.any();

/** Generic return type validator for complex query results. */
export const anyResultValidator = v.any();

export const trackArgs = {
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
