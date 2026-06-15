/** Shared pure helpers + types for the generic analytics component. */

/** A single property value. */
export type Scalar = string | number | boolean | null;

/** Event properties: a flat record of scalar values. */
export type Props = Record<string, Scalar>;

/** Rollup bucket granularity. `minute` is opt-in for short live windows. */
export type Granularity = "minute" | "hour" | "day";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Bucket size in millis for a granularity. */
export function bucketSize(granularity: Granularity): number {
  return granularity === "minute" ? MINUTE_MS : granularity === "hour" ? HOUR_MS : DAY_MS;
}

/** Truncate an epoch-millis timestamp to the start of its `granularity` bucket. */
export function bucketStart(ts: number, granularity: Granularity): number {
  const size = bucketSize(granularity);
  return Math.floor(ts / size) * size;
}

/** Coerce a scalar prop value to the string form used as a rollup `val` key. */
export function valKey(value: Scalar): string {
  return value === null ? "null" : String(value);
}
