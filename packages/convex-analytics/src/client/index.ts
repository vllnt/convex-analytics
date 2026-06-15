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
 * AnalyticsClient — typed, configurable wrapper over the analytics component.
 *
 * Generic over the host's props shape `TProps` for compile-time typing of
 * `track`. Config (`scope`, `dimensions`, `granularities`, ...) is stored on
 * the client and applied to every call — not ignored.
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

  /** Ingest an event: rollup-on-write + raw event + counter. Sampling + dedupe applied. */
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

  /** Total count over a range, optionally filtered by a dimension value. */
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

  /** Top values of a dimension (breakdown). */
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

  /** Bucketed counts over a range. */
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

  /** DAU/WAU/MAU from subjects. */
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

  /** Ordered step conversion (generic, keyed by subjectRef). */
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

  /** Cohort return rates by first-seen period. */
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

  /** Paginated raw events for an event name, newest first. */
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

  /** Persist cron-relevant config (retention/sampling/idle) for the scope. */
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
