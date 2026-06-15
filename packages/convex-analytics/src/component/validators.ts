import { v } from "convex/values";

/** A single property value — string, number, boolean, or null. No nested objects/arrays. */
export const scalarValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.null(),
);

/** Event properties: a flat record of scalar values. The generic, typed default — never `v.any()`. */
export const propsValidator = v.record(v.string(), scalarValidator);

/** A time range in epoch millis. */
export const rangeValidator = v.object({
  from: v.optional(v.number()),
  to: v.optional(v.number()),
});

/** A dimension filter: count only events whose `dim` prop equals `val`. */
export const whereValidator = v.object({
  dim: v.string(),
  val: scalarValidator,
});

/** Rollup bucket granularity. `minute` is opt-in for short live windows. */
export const granularityValidator = v.union(
  v.literal("minute"),
  v.literal("hour"),
  v.literal("day"),
);

/** Array of granularities (the `granularities` config, shared by `track` + `backfill`). */
export const granularitiesValidator = v.array(granularityValidator);

/** A raw event as returned by reads. */
export const eventView = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  scope: v.string(),
  name: v.string(),
  subjectRef: v.optional(v.string()),
  sessionRef: v.optional(v.string()),
  props: propsValidator,
  ts: v.number(),
  seq: v.number(),
  dedupeKey: v.optional(v.string()),
});

/** A `(value, count)` pair for `top` breakdowns. */
export const topRow = v.object({ value: v.string(), count: v.number() });

/** A `(bucket, count)` pair for `timeseries`. */
export const timeseriesPoint = v.object({ bucket: v.number(), count: v.number() });

/** DAU/WAU/MAU rollup of distinct subjects. */
export const uniquesView = v.object({
  dau: v.number(),
  wau: v.number(),
  mau: v.number(),
  trend: v.array(v.object({ bucket: v.number(), uniques: v.number() })),
});

/** A single funnel step result. */
export const funnelStep = v.object({
  name: v.string(),
  count: v.number(),
  rate: v.number(),
});

/** A single retention cohort row. */
export const retentionCohort = v.object({
  cohort: v.number(),
  size: v.number(),
  retained: v.array(v.number()),
});

/** Paginated raw-event page (Convex pagination result shape). */
export const eventPage = v.object({
  page: v.array(eventView),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

/** A single histogram bin: events whose measure falls at or below `upper`. */
export const distributionBin = v.object({ upper: v.number(), count: v.number() });

/** Histogram of a numeric measure: ascending upper-bound bins + an overflow bucket. */
export const distributionView = v.object({
  bins: v.array(distributionBin),
  overflow: v.number(),
  count: v.number(),
  sum: v.number(),
});
