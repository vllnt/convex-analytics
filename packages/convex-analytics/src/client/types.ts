import type { Scalar, Props, Granularity } from "../shared.js";

export type { Scalar, Props, Granularity };

/** A time range in epoch millis. */
export interface Range {
  from?: number;
  to?: number;
}

/** Filter a query to events where one dimension equals one value. */
export interface Where {
  dim: string;
  val: Scalar;
}

/** Client-owned config. Stored on the client and applied to every call. */
export interface AnalyticsConfig {
  /** Multi-tenant partition. Default `"default"`. */
  scope?: string;
  /** Prop keys to roll up on (drives rollup-on-write). Default `[]`. */
  dimensions?: string[];
  /** Rollup bucket granularities. Default `["day"]`. */
  granularities?: Granularity[];
  /** Raw-event TTL in days (rollups kept forever). Default `90`. */
  retentionDays?: number;
  /** Sampling rate `0..1`. Default `1`. */
  sampleRate?: number;
  /** Session idle-close timeout in millis. Default `1800000` (30m). */
  sessionIdleMs?: number;
}

/** Options for a single `track` call. */
export interface TrackOpts<TProps extends Props = Props> {
  subjectRef?: string;
  sessionRef?: string;
  props?: TProps;
  ts?: number;
  /** Override the client's default scope for this event. */
  scope?: string;
  /** Skip if an event with this dedupe key already exists in the scope. */
  dedupeKey?: string;
}

/** Outcome of a `track` call. */
export type TrackResult = "tracked" | "dropped" | "duplicate";

/** A `(value, count)` breakdown row. */
export interface TopRow {
  value: string;
  count: number;
}

/** A `(bucket, count)` timeseries point. */
export interface TimeseriesPoint {
  bucket: number;
  count: number;
}

/** DAU/WAU/MAU rollup. */
export interface UniquesView {
  dau: number;
  wau: number;
  mau: number;
  trend: Array<{ bucket: number; uniques: number }>;
}

/** A funnel step result. */
export interface FunnelStep {
  name: string;
  count: number;
  rate: number;
}

/** A retention cohort row. */
export interface RetentionCohort {
  cohort: number;
  size: number;
  retained: number[];
}

/** A histogram bin: events whose measure is at or below `upper`. */
export interface DistributionBin {
  upper: number;
  count: number;
}

/** Histogram of a numeric measure: bins by ascending upper bound + overflow. */
export interface DistributionView {
  bins: DistributionBin[];
  overflow: number;
  count: number;
  sum: number;
}

/** A raw event as returned by `list`. */
export interface EventView {
  _id: string;
  _creationTime: number;
  scope: string;
  name: string;
  subjectRef?: string;
  sessionRef?: string;
  props: Props;
  ts: number;
  seq: number;
  dedupeKey?: string;
}

/** Convex pagination options. */
export interface PaginationOpts {
  numItems: number;
  cursor: string | null;
}

/** A page of raw events. */
export interface EventPage {
  page: EventView[];
  isDone: boolean;
  continueCursor: string;
}
