/** Shared pure helpers + types for the generic analytics component. */

/** A single property value. */
export type Scalar = string | number | boolean | null;

/** Event properties: a flat record of scalar values. */
export type Props = Record<string, Scalar>;

/** Rollup bucket granularity. */
export type Granularity = "hour" | "day";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Truncate an epoch-millis timestamp to the start of its `granularity` bucket. */
export function bucketStart(ts: number, granularity: Granularity): number {
  const size = granularity === "hour" ? HOUR_MS : DAY_MS;
  return Math.floor(ts / size) * size;
}

/** Bucket size in millis for a granularity. */
export function bucketSize(granularity: Granularity): number {
  return granularity === "hour" ? HOUR_MS : DAY_MS;
}

/** Coerce a scalar prop value to the string form used as a rollup `val` key. */
export function valKey(value: Scalar): string {
  return value === null ? "null" : String(value);
}
