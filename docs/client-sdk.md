# Client SDK reference

Reference for the main entry `@vllnt/convex-analytics` (`AnalyticsClient` and its types),
`@vllnt/convex-analytics/convex.config`, `@vllnt/convex-analytics/test`, the `ComponentApi` type
and the two component functions the client does not wrap. The web preset is
in [Web Preset](./web-preset.md), the React hooks in [React hooks](./react.md), the REST routes
in [REST API](./api-reference.md).

Source: `src/client/index.ts` and `src/client/types.ts` in the package
(`packages/convex-analytics/src/client/` in the repository).

## AnalyticsClient

```ts
// signature
new AnalyticsClient<TProps extends Props = Props>(component: unknown, config?: AnalyticsConfig)
```

`component` is `components.analytics` (or the name you mounted it under). `TProps` types the
`props` passed to `track`. It is compile-time typing only: validate untrusted input in your
own functions. There is no `propsValidator` option.

The client works with any Convex `ctx` that has `runMutation` (for `track` and `configure`) or
`runQuery` (for the reads): queries, mutations, actions and HTTP actions.

```ts
// convex/client.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";

import { components } from "./_generated/api";

type SignupProps = { plan?: string; country?: string };

export const analytics = new AnalyticsClient<SignupProps>(components.analytics, {
  dimensions: ["plan", "country"],
  granularities: ["hour", "day"],
});
```

### AnalyticsConfig

All options are optional; the defaults work with no config.

| Option          | Type                              | Default     | Applied         | Purpose                                                   |
| --------------- | --------------------------------- | ----------- | --------------- | --------------------------------------------------------- |
| `scope`         | `string`                          | `"default"` | every call      | Partition. Every method also takes `opts.scope`.           |
| `dimensions`    | `string[]`                        | `[]`        | every `track`   | Props keys to roll up on. `[]` counts by event name only. |
| `granularities` | `("minute" \| "hour" \| "day")[]` | `["day"]`   | every `track`   | Rollup bucket sizes. Keep `"day"` (see below).            |
| `retentionDays` | `number`                          | `90`        | via `configure` | Raw-event TTL in days. Rollups are kept unless you run `backfill` (see below). |
| `sampleRate`    | `number`                          | `1`         | every `track`   | Share of events kept, from 0 to 1.                        |
| `sessionIdleMs` | `number`                          | `1800000`   | via `configure` | Idle time before the cron closes a session.               |

`top`, and `metric` with a `range` or `where`, read only `day` rollups: if `granularities`
leaves out `"day"`, they return `[]` and `0`. `timeseries` reads the granularity you ask for.

`retentionDays` and `sessionIdleMs` reach the crons only when you call `configure`. Until then
the crons use 90 days and 30 minutes, whatever the constructor says.

Rollups are kept forever unless you run `backfill`: it deletes every rollup row of that name and
rebuilds them only from raw events still retained, so buckets older than `retentionDays` drop to 0.

## Mutations

### track

```ts
// signature
track(ctx, name: string, opts?: TrackOpts<TProps>): Promise<TrackResult>
```

Stores one event: writes the raw event, upserts the session (when `sessionRef` is set) and the
subject (when `subjectRef` is set), increments the total rollup row and one row per declared
dimension present in `props` for each granularity, and increments the lifetime counter. In order:

1. Rate limit: when `sessionRef` is set, a token bucket per `(scope, sessionRef)` refills at
   100 events per minute with capacity 10. Over the limit returns `"dropped"`. The limit is
   fixed. Omitting `sessionRef` skips it.
2. Sampling: when `sampleRate < 1`, the sampled-out share returns `"dropped"`.
3. Dedupe: when `dedupeKey` is set and a retained event in the scope has it, returns
   `"duplicate"`. Pruned events no longer count.
4. Otherwise returns `"tracked"`.

`ts` defaults to the server time. Errors: `EMPTY_STRING`, `INVALID_TIMESTAMP`,
`INVALID_SAMPLE_RATE`, `INVALID_PROP_KEY`, `INVALID_PROP_VALUE` (see
[Errors and fixes](../README.md#errors-and-fixes)).

### configure

```ts
// signature
configure(ctx, opts?: { retentionDays?: number; sampleRate?: number; sessionIdleMs?: number; scope?: string }): Promise<void>
```

Stores `retentionDays` and `sessionIdleMs` in the `config` table for the scope, where the
`prune` and `closeSessions` crons read them. An omitted option falls back to the constructor
config; an option missing from both is not written. `sampleRate` is stored too, but nothing
reads it. Errors: `INVALID_CONFIG`, `INVALID_SAMPLE_RATE`.

## Queries

### metric

```ts
// signature
metric(ctx, name: string, opts?: { range?: Range; where?: Where; scope?: string }): Promise<number>
```

Without `range` and `where`: the lifetime counter for `(scope, name)`, which `prune` and
`backfill` never change. With either: the sum of the matching `day` rollup rows. Range bounds
are rounded down to the start of their day and are inclusive.

### top

```ts
// signature
top(ctx, name: string, dimension: string, opts?: { range?: Range; limit?: number; scope?: string }): Promise<TopRow[]>
```

Values of `dimension` from `day` rollups, ranked by count. `limit` defaults to 20 and is capped
at 100. `value` is always a string. Errors: `INVALID_COUNT`.

### timeseries

```ts
// signature
timeseries(ctx, name: string, opts: { granularity: Granularity; range: Range; where?: Where; scope?: string }): Promise<TimeseriesPoint[]>
```

Counts per bucket, sorted by ascending `bucket` (bucket start in epoch milliseconds). Only
buckets that have events are returned. `range` is required but `{}` reads all buckets.

### uniques

```ts
// signature
uniques(ctx, opts: { range: Range; granularity: Granularity; scope?: string }): Promise<UniquesView>
```

Reads subjects whose last event (`lastSeen`) is in the range (default: the 30 days before
`range.to`, which defaults to now). `wau` / `mau` count those last seen within 7 / 30 days
before `range.to`. `trend` puts each subject in the `granularity` bucket of its last event;
`dau` is the rounded mean of the `trend` buckets (a per-hour mean with `"hour"`), over buckets
that have at least one subject. A subject seen again after `range.to` is not counted.

### funnel

```ts
// signature
funnel(ctx, steps: string[], opts: { range: Range; scope?: string }): Promise<FunnelStep[]>
```

Ordered conversion per `subjectRef`: a subject reaches step `n` when it has a step-`n` event at
or after the time it reached step `n - 1`. `rate` is relative to the first step. Needs at least
2 steps (else the plain `Error` `Funnel requires at least 2 steps`). Reads at most 10,000 events
per step, oldest first; events without `subjectRef` are ignored. Default range: the 30 days
before `range.to`.

### retention

```ts
// signature
retention(ctx, opts: { cohortRange: Range; periods: number; granularity?: Granularity; scope?: string }): Promise<RetentionCohort[]>
```

Groups subjects by the bucket of their first event (`granularity` default `"day"`).
`retained[p]` is the share of the cohort whose last event falls in bucket `p + 1` after the
cohort bucket, so a subject counts in one period only. `periods` is capped at 30; at most
10,000 subjects are read. Default `cohortRange.from`: `periods` buckets before
`cohortRange.to`. Errors: `INVALID_COUNT`.

### distribution

```ts
// signature
distribution(ctx, name: string, measure: string, opts: { buckets: number[]; range?: Range; where?: Where; scope?: string }): Promise<DistributionView>
```

Histogram of the numeric prop `measure`. `buckets` are upper bounds (sorted for you); a value
falls in the first bin whose `upper >= value`, larger values in `overflow`. Non-numeric values
are ignored. `sum / count` is the mean. Reads at most 50,000 raw events in the range, oldest
first, then applies `where`. Default `range.from` is 0. Errors: `INVALID_BUCKETS`.

### list

```ts
// signature
list(ctx, name: string, paginationOpts: PaginationOpts, opts?: { scope?: string }): Promise<EventPage>
```

One page of raw events for an event name, newest first. Pass `cursor: null` first, then the
previous `continueCursor`. Events sharing the exact `ts` at a page boundary can be skipped.
Errors: `INVALID_COUNT`, `INVALID_CURSOR`.

## Identifying entities

The component stores no host id. An entity you slice by (a puzzle, an org, a device) is a value
in `props` under a dimension you declare; `subjectRef`, `sessionRef`, dimension values and
`dedupeKey` are opaque strings you own.

```ts
// convex/puzzles.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics, { dimensions: ["puzzleId"] });

export const play = mutation({
  args: { userId: v.string(), puzzleId: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, puzzleId }) => {
    // once per (puzzle, user), even on retries
    await analytics.track(ctx, "play", {
      subjectRef: userId,
      props: { puzzleId },
      dedupeKey: `${puzzleId}:${userId}`,
    });
    return null;
  },
});

export const plays = query({
  args: { puzzleId: v.string() },
  returns: v.object({
    one: v.number(),
    lastThirty: v.array(v.object({ value: v.string(), count: v.number() })),
  }),
  handler: async (ctx, { puzzleId }) => ({
    one: await analytics.metric(ctx, "play", { where: { dim: "puzzleId", val: puzzleId } }),
    lastThirty: await analytics.top(ctx, "play", "puzzleId", { limit: 30 }),
  }),
});
```

## Types

### Scalar

```ts
// signature
type Scalar = string | number | boolean | null;
```

### Props

```ts
// signature
type Props = Record<string, Scalar>;
```

### Granularity

```ts
// signature
type Granularity = "minute" | "hour" | "day";
```

### Range

```ts
// signature
interface Range { from?: number; to?: number } // epoch milliseconds
```

### Where

```ts
// signature
interface Where { dim: string; val: Scalar } // one dimension equals one value
```

### TrackOpts

```ts
// signature
interface TrackOpts<TProps extends Props = Props> {
  subjectRef?: string;
  sessionRef?: string;
  props?: TProps;
  ts?: number;
  scope?: string;
  dedupeKey?: string;
}
```

### TrackResult

```ts
// signature
type TrackResult = "tracked" | "dropped" | "duplicate";
```

### TopRow

```ts
// signature
interface TopRow { value: string; count: number }
```

### TimeseriesPoint

```ts
// signature
interface TimeseriesPoint { bucket: number; count: number }
```

### UniquesView

```ts
// signature
interface UniquesView { dau: number; wau: number; mau: number; trend: Array<{ bucket: number; uniques: number }> }
```

### FunnelStep

```ts
// signature
interface FunnelStep { name: string; count: number; rate: number }
```

### RetentionCohort

```ts
// signature
interface RetentionCohort { cohort: number; size: number; retained: number[] }
```

### DistributionBin

```ts
// signature
interface DistributionBin { upper: number; count: number }
```

### DistributionView

```ts
// signature
interface DistributionView { bins: DistributionBin[]; overflow: number; count: number; sum: number }
```

### PaginationOpts

```ts
// signature
interface PaginationOpts { numItems: number; cursor: string | null }
```

### EventPage

```ts
// signature
interface EventPage { page: EventView[]; isDone: boolean; continueCursor: string }
```

### EventView

```ts
// signature
interface EventView {
  _id: string;
  _creationTime: number;
  scope: string;
  name: string;
  subjectRef?: string;
  sessionRef?: string;
  props: Props;
  ts: number;
  seq: number; // events the session had before this one; 0 without sessionRef
  dedupeKey?: string;
}
```

## Other entry points

### convex.config default export

`@vllnt/convex-analytics/convex.config` exports the component definition (named
`"analytics"`). It mounts three child components: `@convex-dev/aggregate` (mounted, not used),
`@convex-dev/sharded-counter` and `@convex-dev/rate-limiter`. Mount it once per partition set;
pass `{ name }` to mount it twice and `{ httpPrefix }` to expose the [REST API](./api-reference.md).

```ts
// convex/convex.config.ts
import analytics from "@vllnt/convex-analytics/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(analytics);
export default app;
```

### convex.config.js default export

`@vllnt/convex-analytics/convex.config.js` resolves to the same files as
`@vllnt/convex-analytics/convex.config`, so it exports the same component definition. Use
whichever specifier your tooling expects.

### ComponentApi

```ts
// signature
import type { ComponentApi } from "@vllnt/convex-analytics/_generated/component.js";
```

Type-only entry, generated by Convex codegen: the shape of `components.analytics`, with
`mutations` (`configSet`, `configure`, `track`) and `queries` (`configGet`, `distribution`,
`funnel`, `list`, `metric`, `retention`, `timeseries`, `top`, `uniques`). Use it to type a
helper that takes the mounted component.

### register

```ts
// signature
register(t: TestConvex<SchemaDefinition<GenericSchema, boolean>>, name?: string): void
```

From `@vllnt/convex-analytics/test`. Registers the component with a `convex-test` instance under
`name` (default `"analytics"`) and its child components under `<name>/aggregate`,
`<name>/shardedCounter` and `<name>/rateLimiter`. The entry is TypeScript source that uses
`import.meta.glob`, so run it under Vitest. See the README [Testing](../README.md#testing) section.

### test default export

The default export of `@vllnt/convex-analytics/test` is `{ register, schema, modules }`:
`schema` and `modules` let you call `t.registerComponent` yourself.

## Component functions

The client wraps every component function except these two. Call them on the mounted
component from your own functions.

### configSet

```ts
// signature
ctx.runMutation(components.analytics.mutations.configSet, { scope: string, key: string, value: string }): Promise<null>
```

Creates or replaces the config value at `(scope, key)` and registers the scope. Store REST keys
as `key: "apiKeys"` with `value: JSON.stringify(["key"])`. Errors: `EMPTY_STRING` for an empty
`scope` or `key`.

### configGet

```ts
// signature
ctx.runQuery(components.analytics.queries.configGet, { scope: string, key: string }): Promise<string | null>
```

Returns the stored string at `(scope, key)`, or `null` when there is none. Values written by
`configure` are stringified numbers (for example `"30"`). It returns `apiKeys` too, so do not
expose it through a public query.
