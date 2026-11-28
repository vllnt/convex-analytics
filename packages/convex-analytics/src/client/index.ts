import type {
  GenericMutationCtx,
  GenericQueryCtx,
  GenericDataModel,
} from "convex/server";
import type {
  AnalyticsConfig,
  Props,
  Granularity,
  Range,
  Where,
  TrackOpts,
  TrackResult,
  TopRow,
  TimeseriesPoint,
  UniquesView,
  FunnelStep,
  RetentionCohort,
  DistributionView,
  PaginationOpts,
  EventPage,
} from "./types.js";

export type {
  AnalyticsConfig,
  Range,
  Where,
  TrackOpts,
  TrackResult,
  TopRow,
  TimeseriesPoint,
  UniquesView,
  FunnelStep,
  RetentionCohort,
  DistributionBin,
  DistributionView,
  PaginationOpts,
  EventPage,
  EventView,
} from "./types.js";
export type { Scalar, Props, Granularity } from "../shared.js";

type MutationCtx = {
  runMutation: GenericMutationCtx<GenericDataModel>["runMutation"];
};
type QueryCtx = { runQuery: GenericQueryCtx<GenericDataModel>["runQuery"] };

interface ComponentApi {
  mutations: {
    track: unknown;
    configure: unknown;
    configSet: unknown;
  };
  queries: {
    metric: unknown;
    top: unknown;
    timeseries: unknown;
    uniques: unknown;
    funnel: unknown;
    retention: unknown;
    distribution: unknown;
    list: unknown;
    configGet: unknown;
  };
}

const DEFAULT_SCOPE = "default";

/**
 * Host-side client for the analytics component: `track` events and read
 * aggregates from Convex queries, mutations and actions.
 *
 * Generic over the host's props shape `TProps` for compile-time typing of
 * `track`. `scope`, `dimensions`, `granularities` and `sampleRate` are stored on
 * the client and sent with every call.
 *
 * @example
 * ```ts
 * const analytics = new AnalyticsClient(components.analytics, {
 *   dimensions: ["plan", "source"],
 *   granularities: ["hour", "day"],
 * });
 * await analytics.track(ctx, "signup", { subjectRef: userId, props: { plan: "pro" } });
 * const total = await analytics.metric(ctx, "signup");
 * ```
 *
 * @see https://oss.vllnt.com/packages/convex-analytics
 */
export class AnalyticsClient<TProps extends Props = Props> {
  private readonly component: ComponentApi;
  private readonly scope: string;
  private readonly dimensions: string[];
  private readonly granularities: Granularity[];
  private readonly sampleRate: number;
  private readonly config: AnalyticsConfig;

  constructor(component: unknown, config: AnalyticsConfig = {}) {
    this.component = component as ComponentApi;
    this.config = config;
    this.scope = config.scope ?? DEFAULT_SCOPE;
    this.dimensions = config.dimensions ?? [];
    this.granularities = config.granularities ?? ["day"];
    this.sampleRate = config.sampleRate ?? 1;
  }

  /**
   * Ingest one event: write the raw event, bump the rollup rows and the lifetime counter.
   * Returns `"dropped"` when rate-limited or sampled out, `"duplicate"` when `dedupeKey` matches
   * a retained event in the scope, otherwise `"tracked"`.
   */
  async track(
    ctx: MutationCtx,
    name: string,
    opts: TrackOpts<TProps> = {},
  ): Promise<TrackResult> {
    return (await ctx.runMutation(this.component.mutations.track as never, {
      scope: opts.scope ?? this.scope,
      name,
      subjectRef: opts.subjectRef,
      sessionRef: opts.sessionRef,
      props: opts.props,
      ts: opts.ts,
      dedupeKey: opts.dedupeKey,
      dimensions: this.dimensions,
      granularities: this.granularities,
      sampleRate: this.sampleRate,
    } as never)) as TrackResult;
  }

  /**
   * Event count. Without `range` and `where`: the lifetime counter. With either: the sum of the
   * matching `day` rollup rows (`0` when `granularities` leaves out `"day"`).
   */
  async metric(
    ctx: QueryCtx,
    name: string,
    opts: { range?: Range; where?: Where; scope?: string } = {},
  ): Promise<number> {
    return (await ctx.runQuery(this.component.queries.metric as never, {
      scope: opts.scope ?? this.scope,
      name,
      range: opts.range,
      where: opts.where,
    } as never)) as number;
  }

  /** Top values of one dimension from `day` rollups, by count (`limit` default 20, max 100). */
  async top(
    ctx: QueryCtx,
    name: string,
    dimension: string,
    opts: { range?: Range; limit?: number; scope?: string } = {},
  ): Promise<TopRow[]> {
    return (await ctx.runQuery(this.component.queries.top as never, {
      scope: opts.scope ?? this.scope,
      name,
      dimension,
      range: opts.range,
      limit: opts.limit,
    } as never)) as TopRow[];
  }

  /** Per-bucket counts at one granularity; only buckets with events are returned. */
  async timeseries(
    ctx: QueryCtx,
    name: string,
    opts: { granularity: Granularity; range: Range; where?: Where; scope?: string },
  ): Promise<TimeseriesPoint[]> {
    return (await ctx.runQuery(this.component.queries.timeseries as never, {
      scope: opts.scope ?? this.scope,
      name,
      granularity: opts.granularity,
      range: opts.range,
      where: opts.where,
    } as never)) as TimeseriesPoint[];
  }

  /**
   * Distinct-subject counts from each subject's last-seen time, among subjects last seen inside
   * `range`: `wau` / `mau` count those last seen within 7 / 30 days before `range.to`; `dau` is the
   * rounded mean of the `trend` buckets, one per `granularity` bucket that has a subject (per hour
   * with `"hour"`); empty buckets are left out of `trend` and of the mean.
   */
  async uniques(
    ctx: QueryCtx,
    opts: { range: Range; granularity: Granularity; scope?: string },
  ): Promise<UniquesView> {
    return (await ctx.runQuery(this.component.queries.uniques as never, {
      scope: opts.scope ?? this.scope,
      range: opts.range,
      granularity: opts.granularity,
    } as never)) as UniquesView;
  }

  /** Ordered step conversion keyed by `subjectRef`; needs at least 2 steps. */
  async funnel(
    ctx: QueryCtx,
    steps: string[],
    opts: { range: Range; scope?: string },
  ): Promise<FunnelStep[]> {
    return (await ctx.runQuery(this.component.queries.funnel as never, {
      scope: opts.scope ?? this.scope,
      steps,
      range: opts.range,
    } as never)) as FunnelStep[];
  }

  /**
   * Cohorts by first-seen bucket; `retained[p]` is the share of the cohort whose last event falls
   * in bucket `p + 1` after the cohort bucket (`periods` capped at 30).
   */
  async retention(
    ctx: QueryCtx,
    opts: {
      cohortRange: Range;
      periods: number;
      granularity?: Granularity;
      scope?: string;
    },
  ): Promise<RetentionCohort[]> {
    return (await ctx.runQuery(this.component.queries.retention as never, {
      scope: opts.scope ?? this.scope,
      cohortRange: opts.cohortRange,
      periods: opts.periods,
      granularity: opts.granularity,
    } as never)) as RetentionCohort[];
  }

  /** Histogram of a numeric measure: ascending upper-bound bins + overflow. */
  async distribution(
    ctx: QueryCtx,
    name: string,
    measure: string,
    opts: { buckets: number[]; range?: Range; where?: Where; scope?: string },
  ): Promise<DistributionView> {
    return (await ctx.runQuery(this.component.queries.distribution as never, {
      scope: opts.scope ?? this.scope,
      name,
      measure,
      buckets: opts.buckets,
      range: opts.range,
      where: opts.where,
    } as never)) as DistributionView;
  }

  /** One page of raw events for an event name, newest first. */
  async list(
    ctx: QueryCtx,
    name: string,
    paginationOpts: PaginationOpts,
    opts: { scope?: string } = {},
  ): Promise<EventPage> {
    return (await ctx.runQuery(this.component.queries.list as never, {
      scope: opts.scope ?? this.scope,
      name,
      paginationOpts,
    } as never)) as EventPage;
  }

  /**
   * Store `retentionDays` and `sessionIdleMs` for the scope so the prune and close-sessions crons
   * use them. Omitted options fall back to the constructor config. `sampleRate` is stored too,
   * but nothing reads it: `track` uses the client's `sampleRate`.
   */
  async configure(
    ctx: MutationCtx,
    opts: {
      retentionDays?: number;
      sampleRate?: number;
      sessionIdleMs?: number;
      scope?: string;
    } = {},
  ): Promise<void> {
    await ctx.runMutation(this.component.mutations.configure as never, {
      scope: opts.scope ?? this.scope,
      retentionDays: opts.retentionDays ?? this.config.retentionDays,
      sampleRate: opts.sampleRate ?? this.config.sampleRate,
      sessionIdleMs: opts.sessionIdleMs ?? this.config.sessionIdleMs,
    } as never);
  }
}
