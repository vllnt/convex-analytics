import { ConvexError, v } from "convex/values";

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

/** Stable machine-readable codes carried in `ConvexError.data.code`. */
export type AnalyticsErrorCode =
  | "EMPTY_STRING"
  | "INVALID_TIMESTAMP"
  | "INVALID_SAMPLE_RATE"
  | "INVALID_PROP_KEY"
  | "INVALID_PROP_VALUE"
  | "INVALID_COUNT"
  | "INVALID_CURSOR"
  | "INVALID_BUCKETS"
  | "INVALID_CONFIG";

/** Typed input error: `ConvexError` whose data is `{ code, message }`. */
export function invalidInput(
  code: AnalyticsErrorCode,
  message: string,
): ConvexError<{ code: AnalyticsErrorCode; message: string }> {
  return new ConvexError({ code, message });
}

/** Reject an empty string. `undefined` (an omitted optional field) passes. */
export function assertNonEmpty(field: string, value: string | undefined): void {
  if (value === "") {
    throw invalidInput("EMPTY_STRING", `${field} must not be empty`);
  }
}

/** Reject NaN and +/-Infinity epoch-millis values. `undefined` passes. */
export function assertFiniteTs(field: string, value: number | undefined): void {
  if (value !== undefined && !Number.isFinite(value)) {
    throw invalidInput("INVALID_TIMESTAMP", `${field} must be a finite number`);
  }
}

/** Reject non-finite `from` / `to` bounds of an optional range. */
export function assertRange(range: { from?: number; to?: number } | undefined): void {
  assertFiniteTs("range.from", range?.from);
  assertFiniteTs("range.to", range?.to);
}

/** Reject anything but a positive integer. `undefined` passes. */
export function assertCount(field: string, value: number | undefined): void {
  if (value !== undefined && !(Number.isInteger(value) && value > 0)) {
    throw invalidInput("INVALID_COUNT", `${field} must be a positive integer`);
  }
}

/** Reject a sample rate that is not a finite number in `[0, 1]`. `undefined` passes. */
export function assertSampleRate(value: number | undefined): void {
  if (value !== undefined && !(value >= 0 && value <= 1)) {
    throw invalidInput("INVALID_SAMPLE_RATE", "sampleRate must be a number between 0 and 1");
  }
}

/** Convex field names: 1-1024 printable ASCII characters, not starting with `$` (or empty). */
const PROP_KEY = /^(?!\$)[\x20-\x7e]{0,1024}$/;

/**
 * Reject NaN / +/-Infinity numbers and prop keys Convex cannot store (non-ASCII, control
 * characters, leading `$`, over 1024 characters). Convex rejects bad keys before a mutation
 * runs, so the key check matters for callers that validate first, such as the HTTP route.
 */
export function assertProps(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    if (!PROP_KEY.test(key)) {
      throw invalidInput(
        "INVALID_PROP_KEY",
        "props keys must be printable ASCII, at most 1024 characters, and not start with $",
      );
    }
    if (value !== null && typeof value === "object") {
      throw invalidInput("INVALID_PROP_VALUE", `props.${key} must be a scalar, not an object or array`);
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw invalidInput("INVALID_PROP_VALUE", `props.${key} must be a finite number`);
    }
  }
}
