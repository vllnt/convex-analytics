# Client SDK

TypeScript API reference for the `AnalyticsClient<TProps>` class.

Source: `packages/convex-analytics/src/client/index.ts`

## Constructor

```ts
new AnalyticsClient<TProps>(component: unknown, config?: AnalyticsConfig)
```

`component` comes from `components.analytics` after mounting. `TProps` types the `props`
passed to `track` (defaults to `Record<string, Scalar>`).

### AnalyticsConfig

Stored on the client and applied to every call. All optional.

```ts
interface AnalyticsConfig {
  scope?: string;            // default "default"
  dimensions?: string[];     // default []
  granularities?: ("hour" | "day")[]; // default ["day"]
  retentionDays?: number;    // default 90
  sampleRate?: number;       // 0..1, default 1
  sessionIdleMs?: number;    // default 1_800_000 (30m)
}
```

| Option | Default | Applied | Purpose |
|--------|---------|---------|---------|
| `scope` | `"default"` | per call | Multi-tenant partition. Overridable per call via `opts.scope`. |
| `dimensions` | `[]` | per `track` | Prop keys to roll up on. Empty = count by event name only. |
| `granularities` | `["day"]` | per `track` | Rollup bucket sizes. |
| `retentionDays` | `90` | via `configure` | Raw-event TTL in days. Rollups kept forever. |
| `sampleRate` | `1` | per `track` | Fraction of events kept at ingest. |
| `sessionIdleMs` | `1_800_000` | via `configure` | Idle timeout before a session is closed. |

`dimensions`, `granularities`, and `sampleRate` are passed into each `track` call. The
cron-relevant values (`retentionDays`, `sampleRate`, `sessionIdleMs`) are persisted to the
`config` table by calling `configure` once.

## Mutations

### track

```ts
track(
  ctx: MutationCtx,
  name: string,
  opts?: {
    subjectRef?: string;
    sessionRef?: string;
    props?: TProps;
    ts?: number;
    scope?: string;
    dedupeKey?: string;
  },
): Promise<"tracked" | "dropped" | "duplicate">
```

Ingest one event. Rollup-on-write: increments the total + each host-declared dimension
present in `props`, writes the raw event, and bumps the sharded counter and aggregate.

- **Rate limit** — when `sessionRef` is set, a per-session token bucket applies; over-limit returns `"dropped"`.
- **Sampling** — when `sampleRate < 1`, a fraction of events return `"dropped"`.
- **Dedupe** — when `dedupeKey` is set and an event already exists for it in the scope, returns `"duplicate"`.
- Otherwise returns `"tracked"`.

### configure

```ts
configure(
  ctx: MutationCtx,
  opts?: {
    retentionDays?: number;
    sampleRate?: number;
    sessionIdleMs?: number;
    scope?: string;
  },
): Promise<void>
```

Persist cron-relevant config for the scope so the `prune` and `closeSessions` crons can read
it. Falls back to the client's constructor config when an option is omitted.

## Queries

### metric

```ts
metric(ctx, name, opts?: { range?: Range; where?: Where; scope?: string }): Promise<number>
```

Total count for an event. With no `range`/`where`, reads the O(1) sharded counter. With a
range or a `where` filter, sums the matching daily rollup rows.

### top

```ts
top(ctx, name, dimension, opts?: { range?: Range; limit?: number; scope?: string }): Promise<TopRow[]>
```

Top values of a dimension, ranked by count (default `limit` 20, max 100). Returns
`{ value, count }[]`.

### timeseries

```ts
timeseries(ctx, name, opts: { granularity: Granularity; range: Range; where?: Where; scope?: string }): Promise<TimeseriesPoint[]>
```

Bucketed counts. Returns `{ bucket, count }[]` sorted ascending by bucket.

### uniques

```ts
uniques(ctx, opts: { range: Range; granularity: Granularity; scope?: string }): Promise<UniquesView>
```

Distinct-subject counts. Returns `{ dau, wau, mau, trend }` where `trend` is
`{ bucket, uniques }[]`.

### funnel

```ts
funnel(ctx, steps: string[], opts: { range: Range; scope?: string }): Promise<FunnelStep[]>
```

Ordered step conversion, keyed by `subjectRef`. Requires at least 2 steps; scans up to
10,000 events per step. Returns `{ name, count, rate }[]` (rate relative to the first step).

### retention

```ts
retention(ctx, opts: { cohortRange: Range; periods: number; granularity?: Granularity; scope?: string }): Promise<RetentionCohort[]>
```

Cohort return rates by first-seen period (default `granularity` `"day"`, `periods` capped at
30). Returns `{ cohort, size, retained }[]` where `retained[p]` is the return fraction for
period `p+1`.

### list

```ts
list(ctx, name, paginationOpts: { numItems: number; cursor: string | null }, opts?: { scope?: string }): Promise<EventPage>
```

Paginated raw events for an event name, newest first. Returns
`{ page, isDone, continueCursor }`.

## Types

```ts
type Scalar = string | number | boolean | null;
type Props = Record<string, Scalar>;
type Granularity = "hour" | "day";

interface Range { from?: number; to?: number; }          // epoch ms
interface Where { dim: string; val: Scalar; }            // one dimension == one value
interface TopRow { value: string; count: number; }
interface TimeseriesPoint { bucket: number; count: number; }
interface UniquesView {
  dau: number; wau: number; mau: number;
  trend: Array<{ bucket: number; uniques: number }>;
}
interface FunnelStep { name: string; count: number; rate: number; }
interface RetentionCohort { cohort: number; size: number; retained: number[]; }
interface EventView {
  _id: string; _creationTime: number;
  scope: string; name: string;
  subjectRef?: string; sessionRef?: string;
  props: Props; ts: number; seq: number; dedupeKey?: string;
}
interface EventPage { page: EventView[]; isDone: boolean; continueCursor: string; }
```
