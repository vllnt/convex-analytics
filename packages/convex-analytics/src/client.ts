import type { GenericMutationCtx, GenericQueryCtx, GenericDataModel } from "convex/server";

export interface ConvexAnalyticsConfig {
  retentionDays?: number;
  rateLimitPerMin?: number;
  apiKeys?: string[];
}

export interface TrackMetadata {
  projectId?: string;
  env?: string;
  platform?: string;
  timestamp?: number;
  path?: string;
  locale?: string;
  referrer?: string;
  device?: string;
  browser?: string;
  os?: string;
  country?: string;
  region?: string | null;
  city?: string | null;
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

export type Dimension =
  | "locale"
  | "path"
  | "device"
  | "browser"
  | "os"
  | "country"
  | "referrer"
  | "utmSource"
  | "utmMedium"
  | "utmCampaign"
  | "projectId"
  | "env"
  | "platform";

export type DefaultEventMap = Record<string, Record<string, unknown>>;

interface PaginatedResult<T> {
  data: T[];
  hasMore: boolean;
  cursor: string | null;
}

interface SummaryItem {
  name: string;
  count: number;
}

interface QueryOpts {
  from?: number;
  to?: number;
  projectId?: string;
  env?: string;
  platform?: string;
  compare?: "previous_period";
}

interface PaginationOpts extends QueryOpts {
  limit?: number;
  cursor?: string;
}

type MutationCtx = { runMutation: GenericMutationCtx<GenericDataModel>["runMutation"] };
type QueryCtx = { runQuery: GenericQueryCtx<GenericDataModel>["runQuery"] };

/**
 * ConvexAnalytics — typed client wrapper for the analytics component.
 *
 * Untyped (default — zero friction):
 *   `const analytics = new ConvexAnalytics(component)`
 *
 * Typed (opt-in — compile-time safety):
 *   `const analytics = new ConvexAnalytics<MyEvents>(component)`
 */
export class ConvexAnalytics<
  TEvents extends Record<string, Record<string, unknown>> = DefaultEventMap,
> {
  private component: unknown;
  private _debug = false;

  constructor(component: unknown, _config?: ConvexAnalyticsConfig) {
    this.component = component;
  }

  debug(enabled: boolean): void {
    this._debug = enabled;
  }

  async track<K extends keyof TEvents & string>(
    ctx: MutationCtx,
    userId: string,
    sessionId: string,
    name: K,
    properties?: TEvents[K],
    metadata?: TrackMetadata,
  ): Promise<void> {
    if (this._debug) {
      console.log("[convex-analytics] track", { name, userId, sessionId, properties, metadata });
    }
    const api = this.component as { track: { track: unknown } };
    await ctx.runMutation(api.track.track as never, ({
      userId,
      sessionId,
      name,
      properties: properties ?? {},
      ...metadata,
    }) as never);
  }

  async identify(
    ctx: MutationCtx,
    userId: string,
    traits?: Record<string, unknown>,
  ): Promise<void> {
    const api = this.component as { track: { identify: unknown } };
    await ctx.runMutation(api.track.identify as never, ({
      userId,
      traits,
    }) as never);
  }

  async alias(
    ctx: MutationCtx,
    anonymousId: string,
    identifiedId: string,
  ): Promise<void> {
    const api = this.component as { track: { alias: unknown } };
    await ctx.runMutation(api.track.alias as never, ({
      anonymousId,
      identifiedId,
    }) as never);
  }

  async count(
    ctx: QueryCtx,
    name: keyof TEvents & string,
    opts?: QueryOpts,
  ): Promise<number> {
    const api = this.component as { queries: { count: unknown } };
    return await ctx.runQuery(api.queries.count as never, ({
      name,
      from: opts?.from,
      to: opts?.to,
    }) as never);
  }

  async list(
    ctx: QueryCtx,
    name: keyof TEvents & string,
    opts?: PaginationOpts,
  ): Promise<PaginatedResult<unknown>> {
    const api = this.component as { queries: { list: unknown } };
    return await ctx.runQuery(api.queries.list as never, ({
      name,
      projectId: opts?.projectId,
      env: opts?.env,
      platform: opts?.platform,
      from: opts?.from,
      to: opts?.to,
      limit: opts?.limit,
      cursor: opts?.cursor,
    }) as never);
  }

  async summary(
    ctx: QueryCtx,
    opts?: { projectId?: string },
  ): Promise<SummaryItem[]> {
    const api = this.component as { queries: { summary: unknown } };
    return await ctx.runQuery(api.queries.summary as never, ({
      projectId: opts?.projectId,
    }) as never);
  }
}
