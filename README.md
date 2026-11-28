# @vllnt/convex-analytics

TypeScript Convex component for event analytics: track events, roll up counts on write, and query metrics, breakdowns, time series, funnels and retention.

## For coding agents

Docs for the installed version are in `node_modules/@vllnt/convex-analytics/`: `docs/`, `llms.txt`, `CHANGELOG.md` and the TypeScript `src/`.
Every signature is in [docs/client-sdk.md](docs/client-sdk.md); every error is in [Errors and fixes](#errors-and-fixes).

## When to use

- Use it when a Convex app needs event counts, breakdowns and time series that its own queries read reactively.
- Use it when you know the props you slice by up front, so counts can be rolled up as each event is written.
- Use it when you also need funnels, retention cohorts, distinct-subject counts or histograms over retained raw events.
- Do not use it when you need cookie-consent state and consent-gated tracking in a React app: use [`@vllnt/analytics`](https://oss.vllnt.com/packages/analytics).
- Do not use it when you need a per-subject activity feed read back event by event: use [`@vllnt/convex-events`](https://oss.vllnt.com/packages/convex-events).
- Do not use it when you need A/B variant assignment with exposure tracking: use [`@vllnt/convex-experiments`](https://oss.vllnt.com/packages/convex-experiments).

## Install

```bash
npm install @vllnt/convex-analytics
```

This installs the latest stable release; `@canary` follows `main`.

## Quick start

```ts
// convex/convex.config.ts
import analytics from "@vllnt/convex-analytics/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(analytics);
export default app;
```

```ts
// convex/analytics.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics, {
  dimensions: ["plan"], // props keys to roll up on
});

export const signup = mutation({
  args: { userId: v.string(), plan: v.string() },
  returns: v.union(v.literal("tracked"), v.literal("dropped"), v.literal("duplicate")),
  handler: async (ctx, { userId, plan }) =>
    await analytics.track(ctx, "signup", { subjectRef: userId, props: { plan } }),
});

export const signupsByPlan = query({
  args: {},
  returns: v.array(v.object({ value: v.string(), count: v.number() })),
  handler: async (ctx) => await analytics.top(ctx, "signup", "plan"),
});
```

Run `npx convex dev` once to generate `components.analytics`. After one `signup` with
`plan: "pro"`, `signupsByPlan` returns `[{ value: "pro", count: 1 }]`. The component never
reads auth: the host decides who may call these functions and what `subjectRef` is.

[![npm](https://img.shields.io/npm/v/@vllnt/convex-analytics.svg)](https://www.npmjs.com/package/@vllnt/convex-analytics)
[![CI](https://github.com/vllnt/convex-analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-analytics/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-analytics.svg)](LICENSE)

## API

Full reference: [docs/client-sdk.md](docs/client-sdk.md) (main entry, `./convex.config`,
`./test`), [docs/web-preset.md](docs/web-preset.md) (`./web`), [docs/react.md](docs/react.md)
(`./react`), [docs/api-reference.md](docs/api-reference.md) (REST routes).

| Export | Import from | What it does |
| --- | --- | --- |
| [`AnalyticsClient`](docs/client-sdk.md#analyticsclient) | `@vllnt/convex-analytics` | Host client: `new AnalyticsClient<TProps>(components.analytics, config?)` |
| [`track(ctx, name, opts?)`](docs/client-sdk.md#track) | `AnalyticsClient` method, mutation | Store one event and bump its rollups; returns `"tracked"`, `"dropped"` or `"duplicate"` |
| [`metric(ctx, name, opts?)`](docs/client-sdk.md#metric) | `AnalyticsClient` method, query | Event count, optionally in a `range` and filtered by one dimension value |
| [`top(ctx, name, dimension, opts?)`](docs/client-sdk.md#top) | `AnalyticsClient` method, query | Values of one dimension ranked by count |
| [`timeseries(ctx, name, opts)`](docs/client-sdk.md#timeseries) | `AnalyticsClient` method, query | Counts per minute, hour or day bucket |
| [`uniques(ctx, opts)`](docs/client-sdk.md#uniques) | `AnalyticsClient` method, query | Distinct subjects: `dau`, `wau`, `mau`, `trend` |
| [`funnel(ctx, steps, opts)`](docs/client-sdk.md#funnel) | `AnalyticsClient` method, query | Ordered step conversion per `subjectRef` |
| [`retention(ctx, opts)`](docs/client-sdk.md#retention) | `AnalyticsClient` method, query | Cohorts by first-seen bucket |
| [`distribution(ctx, name, measure, opts)`](docs/client-sdk.md#distribution) | `AnalyticsClient` method, query | Histogram of a numeric prop |
| [`list(ctx, name, paginationOpts, opts?)`](docs/client-sdk.md#list) | `AnalyticsClient` method, query | One page of raw events, newest first |
| [`configure(ctx, opts?)`](docs/client-sdk.md#configure) | `AnalyticsClient` method, mutation | Store `retentionDays` / `sessionIdleMs` for the crons |
| [`AnalyticsConfig`](docs/client-sdk.md#analyticsconfig) | `@vllnt/convex-analytics` (type) | Constructor options |
| [`TrackOpts`](docs/client-sdk.md#trackopts) | `@vllnt/convex-analytics` (type) | Options of `track` |
| [`TrackResult`](docs/client-sdk.md#trackresult) | `@vllnt/convex-analytics` (type) | `"tracked" \| "dropped" \| "duplicate"` |
| [`Scalar`](docs/client-sdk.md#scalar) | `@vllnt/convex-analytics` (type) | `string \| number \| boolean \| null` |
| [`Props`](docs/client-sdk.md#props) | `@vllnt/convex-analytics` (type) | `Record<string, Scalar>` |
| [`Granularity`](docs/client-sdk.md#granularity) | `@vllnt/convex-analytics`, `./react` (type) | `"minute" \| "hour" \| "day"` |
| [`Range`](docs/client-sdk.md#range) | `@vllnt/convex-analytics`, `./react` (type) | `{ from?, to? }` in epoch milliseconds |
| [`Where`](docs/client-sdk.md#where) | `@vllnt/convex-analytics`, `./react` (type) | `{ dim, val }`: one dimension equals one value |
| [`TopRow`](docs/client-sdk.md#toprow) | `@vllnt/convex-analytics`, `./react` (type) | `{ value, count }` |
| [`TimeseriesPoint`](docs/client-sdk.md#timeseriespoint) | `@vllnt/convex-analytics`, `./react` (type) | `{ bucket, count }` |
| [`UniquesView`](docs/client-sdk.md#uniquesview) | `@vllnt/convex-analytics`, `./react` (type) | `{ dau, wau, mau, trend }` |
| [`FunnelStep`](docs/client-sdk.md#funnelstep) | `@vllnt/convex-analytics` (type) | `{ name, count, rate }` |
| [`RetentionCohort`](docs/client-sdk.md#retentioncohort) | `@vllnt/convex-analytics` (type) | `{ cohort, size, retained }` |
| [`DistributionBin`](docs/client-sdk.md#distributionbin) | `@vllnt/convex-analytics` (type) | `{ upper, count }` |
| [`DistributionView`](docs/client-sdk.md#distributionview) | `@vllnt/convex-analytics` (type) | `{ bins, overflow, count, sum }` |
| [`PaginationOpts`](docs/client-sdk.md#paginationopts) | `@vllnt/convex-analytics` (type) | `{ numItems, cursor }` |
| [`EventPage`](docs/client-sdk.md#eventpage) | `@vllnt/convex-analytics` (type) | `{ page, isDone, continueCursor }` |
| [`EventView`](docs/client-sdk.md#eventview) | `@vllnt/convex-analytics` (type) | One raw event returned by `list` |
| [`configSet`](docs/client-sdk.md#configset) | `components.analytics.mutations` | Component mutation: store one config value, such as the REST `apiKeys` |
| [`configGet`](docs/client-sdk.md#configget) | `components.analytics.queries` | Component query: read one stored config value, or `null` |
| [`default` (component definition)](docs/client-sdk.md#convexconfig-default-export) | `@vllnt/convex-analytics/convex.config` | Pass to `app.use(...)` |
| [`default` (component definition, `.js` path)](docs/client-sdk.md#convexconfigjs-default-export) | `@vllnt/convex-analytics/convex.config.js` | The same definition under a `.js` specifier |
| [`ComponentApi`](docs/client-sdk.md#componentapi) | `@vllnt/convex-analytics/_generated/component.js` (type) | Type of `components.analytics` |
| [`register`](docs/client-sdk.md#register) | `@vllnt/convex-analytics/test` | Mount the component and its child components in `convex-test` |
| [`default` (test helpers)](docs/client-sdk.md#test-default-export) | `@vllnt/convex-analytics/test` | `{ register, schema, modules }` |
| [`webDimensions`](docs/web-preset.md#webdimensions) | `@vllnt/convex-analytics/web` | The nine web prop keys to pass as `dimensions` |
| [`WebDimension`](docs/web-preset.md#webdimension) | `@vllnt/convex-analytics/web` (type) | One key of `webDimensions` |
| [`parseUserAgent`](docs/web-preset.md#parseuseragent) | `@vllnt/convex-analytics/web` | `User-Agent` to `{ device, browser, os }` |
| [`UserAgentInfo`](docs/web-preset.md#useragentinfo) | `@vllnt/convex-analytics/web` (type) | Result of `parseUserAgent` |
| [`geoFromHeaders`](docs/web-preset.md#geofromheaders) | `@vllnt/convex-analytics/web` | Cloudflare / Vercel headers to `{ country, region?, city? }` |
| [`GeoInfo`](docs/web-preset.md#geoinfo) | `@vllnt/convex-analytics/web` (type) | Result of `geoFromHeaders` |
| [`trackPageview`](docs/web-preset.md#trackpageview) | `@vllnt/convex-analytics/web` | Build web props and `track` a `"page_view"` event |
| [`TrackPageviewOpts`](docs/web-preset.md#trackpageviewopts) | `@vllnt/convex-analytics/web` (type) | Options of `trackPageview` |
| [`Utm`](docs/web-preset.md#utm) | `@vllnt/convex-analytics/web` (type) | `{ source?, medium?, campaign? }` |
| [`useMetric`](docs/react.md#usemetric) | `@vllnt/convex-analytics/react` | Reactive `metric` through a host query |
| [`useTop`](docs/react.md#usetop) | `@vllnt/convex-analytics/react` | Reactive `top` through a host query |
| [`useTimeseries`](docs/react.md#usetimeseries) | `@vllnt/convex-analytics/react` | Reactive `timeseries` through a host query |
| [`useUniques`](docs/react.md#useuniques) | `@vllnt/convex-analytics/react` | Reactive `uniques` through a host query |
| [`MetricArgs`](docs/react.md#metricargs) | `@vllnt/convex-analytics/react` (type) | Expected args of the host `metric` query |
| [`TopArgs`](docs/react.md#topargs) | `@vllnt/convex-analytics/react` (type) | Expected args of the host `top` query |
| [`TimeseriesArgs`](docs/react.md#timeseriesargs) | `@vllnt/convex-analytics/react` (type) | Expected args of the host `timeseries` query |
| [`UniquesArgs`](docs/react.md#uniquesargs) | `@vllnt/convex-analytics/react` (type) | Expected args of the host `uniques` query |

## Common tasks

Count one dimension value in a date range, as a total and per day:

```ts
// convex/reports.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics, { dimensions: ["plan"] });

export const proSignups = query({
  args: { from: v.number(), to: v.number() },
  returns: v.object({
    total: v.number(),
    daily: v.array(v.object({ bucket: v.number(), count: v.number() })),
  }),
  handler: async (ctx, { from, to }) => {
    const range = { from, to };
    const where = { dim: "plan", val: "pro" };
    const total = await analytics.metric(ctx, "signup", { range, where });
    const daily = await analytics.timeseries(ctx, "signup", { granularity: "day", range, where });
    return { total, daily };
  },
});
```

Count an outcome once, even when the mutation is retried, with your own `dedupeKey`:

```ts
// convex/games.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics, { dimensions: ["puzzleId"] });

export const solved = mutation({
  args: { userId: v.string(), puzzleId: v.string(), seconds: v.number() },
  returns: v.boolean(),
  handler: async (ctx, { userId, puzzleId, seconds }) => {
    const result = await analytics.track(ctx, "solved", {
      subjectRef: userId,
      props: { puzzleId, seconds },
      dedupeKey: `${puzzleId}:${userId}`,
    });
    return result === "tracked";
  },
});
```

Compare platforms (web against mobile): add a `platform` prop to `dimensions` and read
`top(ctx, name, "platform")` or a `where: { dim: "platform", val: "ios" }` filter, or give each
platform its own `scope` ([multi-product](docs/multi-product.md)).

Funnel, retention and a histogram of a numeric prop:

```ts
// convex/insights.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics);

export const insights = query({
  args: { from: v.number(), to: v.number() },
  returns: v.object({ checkoutRate: v.number(), cohorts: v.number(), underOneMinute: v.number() }),
  handler: async (ctx, { from, to }) => {
    const range = { from, to };
    const steps = await analytics.funnel(ctx, ["view", "add_to_cart", "checkout"], { range });
    const cohorts = await analytics.retention(ctx, { cohortRange: range, periods: 7 });
    const times = await analytics.distribution(ctx, "solved", "seconds", {
      buckets: [60, 300, 900],
      range,
    });
    return {
      checkoutRate: steps.at(-1)?.rate ?? 0,
      cohorts: cohorts.length,
      underOneMinute: times.bins[0]?.count ?? 0,
    };
  },
});
```

Read aggregates reactively in React: re-export a host query, then pass it to a hook:

```ts
// convex/dashboard.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics);

export const metric = query({
  args: { name: v.string() },
  returns: v.number(),
  handler: async (ctx, { name }) => await analytics.metric(ctx, name),
});
```

```tsx
// src/SignupCount.tsx
import { useMetric } from "@vllnt/convex-analytics/react";

import { api } from "../convex/_generated/api";

export function SignupCount() {
  const count = useMetric(api.dashboard.metric, { name: "signup" });
  return <p>{count === undefined ? "Loading" : `${String(count)} signups`}</p>;
}
```

Track page views from an HTTP action with the web preset:

```ts
// convex/http.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { trackPageview, webDimensions } from "@vllnt/convex-analytics/web";
import { httpRouter } from "convex/server";

import { components } from "./_generated/api";
import { httpAction } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics, { dimensions: [...webDimensions] });

const http = httpRouter();
http.route({
  path: "/pageview",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = (await request.json()) as { path: string; referrer?: string };
    await trackPageview(analytics, ctx, {
      path: body.path,
      referrer: body.referrer,
      ua: request.headers.get("user-agent") ?? undefined,
      headers: request.headers,
    });
    return new Response(null, { status: 204 });
  }),
});
export default http;
```

Set raw-event retention and the session idle timeout for the crons (run once, for example
with `npx convex run setup:configureAnalytics`):

```ts
// convex/setup.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics, {
  retentionDays: 30,
  sessionIdleMs: 15 * 60 * 1000,
});

export const configureAnalytics = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await analytics.configure(ctx);
    return null;
  },
});

export const setApiKey = internalMutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    await ctx.runMutation(components.analytics.mutations.configSet, {
      scope: "default",
      key: "apiKeys",
      value: JSON.stringify([key]),
    });
    return null;
  },
});
```

Expose the REST routes: mount with an `httpPrefix`, store a key with `setApiKey` above, then
call a route with that key ([REST API](docs/api-reference.md)):

```ts
// convex/convex.config.ts
import analytics from "@vllnt/convex-analytics/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(analytics, { httpPrefix: "/analytics" });
export default app;
```

```bash
curl -H "x-api-key: $ANALYTICS_API_KEY" \
  "https://<deployment>.convex.site/analytics/metric?name=signup"
```

Re-derive rollups after changing `dimensions` (`backfill` is internal to the component, so
run it from the CLI; it handles one event name per call).

> [!WARNING]
> `backfill` deletes every rollup row of that `(scope, name)` and rebuilds them only from raw
> events still retained, so buckets older than `retentionDays` drop to 0. Run it only when the
> retained raw events cover every bucket you still need.

```bash
npx convex run --component analytics internal_mutations:backfill \
  '{"scope":"default","name":"signup","dimensions":["plan"],"granularities":["day"]}'
```

## Errors and fixes

Input errors are a `ConvexError` whose `data` is `{ code, message }`; REST routes return
them as `400 { "error", "code" }`. Branch on `data.code`.

| Error | Cause | Fix |
| --- | --- | --- |
| `EMPTY_STRING` | `scope`, `name`, `subjectRef`, `sessionRef`, `dedupeKey`, a `dimensions` entry, or a `configSet` `key` is `""` | Omit the optional field instead of passing `""` |
| `INVALID_TIMESTAMP` | `ts`, `range.from` or `range.to` is `NaN` or infinite (REST: a blank or non-numeric `from` / `to`) | Pass epoch milliseconds as finite numbers |
| `INVALID_SAMPLE_RATE` | `sampleRate` is not a number from 0 to 1 | Use a value in `[0, 1]` |
| `INVALID_PROP_KEY` | A `props` key is not printable ASCII, is over 1024 characters, or starts with `$` (checked by `POST /track`; Convex rejects such keys first on function calls) | Rename the key |
| `INVALID_PROP_VALUE` | A `props` value is `NaN`, infinite, an object or an array | Send flat scalar values only |
| `INVALID_COUNT` | `limit`, `periods` or `numItems` is not a positive integer | Pass an integer of 1 or more |
| `INVALID_CURSOR` | A `list` cursor was not returned by `list` | Pass `null` or the previous `continueCursor` |
| `INVALID_BUCKETS` | A `distribution` bucket bound is `NaN` or infinite | Pass finite numbers |
| `INVALID_CONFIG` | `retentionDays` or `sessionIdleMs` passed to `configure` is not a positive finite number | Pass a number above 0 |
| `Funnel requires at least 2 steps` | `funnel` got fewer than 2 steps (a plain `Error`, not a `ConvexError`) | Pass 2 or more event names |
| `backfill requires at most 50000 retained events; existing rollups were preserved` | `backfill` found more than 50,000 raw events for the name (plain `Error`) | Wait for `prune` to remove old events or lower `retentionDays`, then retry |
| Convex argument validation error | An argument does not match the function validator, for example a nested `props` value or an unknown granularity | Match the types in [docs/client-sdk.md](docs/client-sdk.md) |
| 401 `Missing x-api-key header` | REST request without `x-api-key` | Send the header |
| 401 `API keys not configured` | No `apiKeys` config row for the request's `scope`, or the stored value is `""` | Store keys with `configSet` for that scope |
| 401 `Invalid API key` | The key is not in the scope's `apiKeys` list | Send a stored key or add it |
| 500 `API keys misconfigured` | The stored `apiKeys` value is not a JSON array of strings | Store `JSON.stringify(["key"])` |
| 400 `Invalid JSON body` | `POST /track` body is not JSON | Send a JSON body |
| 400 `Body must be a JSON object` | `POST /track` body is an array, `null` or a scalar | Send a JSON object |
| 400 `name is required` | `POST /track` without a non-empty string `name` | Add `name` |
| 400 `dimensions (string[]) is required` | `POST /track` without a `dimensions` string array | Add `"dimensions": []` or your keys |
| 400 `props must be a flat object of scalar values` | `POST /track` `props` is not an object | Send an object of scalars |
| 400 `granularities must be an array of minute, hour, or day` | `POST /track` `granularities` has another value | Use `minute`, `hour` or `day` |
| 400 `name parameter required` | `GET /metric` or `/top` or `/timeseries` without `name` | Add `?name=` |
| 400 `dimension parameter required` | `GET /top` without `dimension` | Add `&dimension=` |
| 400 `granularity must be minute, hour, or day` | `GET /timeseries` or `/uniques` with another `granularity` | Use `minute`, `hour` or `day` |

## Limits and gotchas

- It serves the in-app counts your Convex functions read; it complements a data warehouse and
  does not replace one. Questions on props not listed in `dimensions` (unless you `backfill`
  while the raw events are retained), or on raw events older than `retentionDays`, need an
  export of the raw events (for example by paging `list`) to your own store.
- `track` returns `"dropped"` (no error) when sampled out, or when a `sessionRef` exceeds its
  rate limit: a token bucket per `(scope, sessionRef)` refilling 100 events per minute with
  capacity 10. The limit is fixed. Events without `sessionRef` skip the limiter.
- Only keys listed in `dimensions` are rolled up; other props are stored on the raw event but
  cannot be read with `metric` / `top` / `timeseries`. Changing `dimensions` does not rewrite
  past rollups: run `backfill`, which can only use raw events not yet pruned. Raw events (for
  `funnel`, `distribution`, `list`, `backfill`) are kept only for `retentionDays`. Rollups are
  kept forever unless you run `backfill`: it deletes every rollup row of that name and rebuilds
  them only from raw events still retained, so buckets older than `retentionDays` drop to 0.
- Rollup values are strings: `true`, `1` and `null` become `"true"`, `"1"` and `"null"`, so
  `top` returns strings and `where: { dim, val: 1 }` also matches the string `"1"`.
- `top`, and `metric` with a `range` or `where`, read only `day` rollups: if `granularities`
  leaves out `"day"` they return `[]` and `0`. `timeseries` at a granularity you do not write
  returns `[]`. An empty `granularities` array means `["day"]`.
- `timeseries` returns only buckets that have events; it does not fill gaps with zeros.
- `metric` without `range` and `where` reads a lifetime counter (16 shards) that `prune` and
  `backfill` never change.
- `top`: `limit` defaults to 20 and is capped at 100. It reads every `day` rollup row of the
  event name in the range (all dimensions), so its cost grows with the number of dimension values.
- `metric`, `top`, `timeseries` and `uniques` collect all matching rows; very wide ranges can hit
  Convex's per-function read limits.
- `funnel` reads at most 10,000 events per step, oldest first, and skips events without
  `subjectRef`. Default range: the 30 days before `range.to` (or now).
- `retention` reads at most 10,000 subjects and caps `periods` at 30. A subject counts only in
  the period of its last event, not in every period it returned.
- `uniques` counts each subject once, at its last event, among subjects last seen inside
  `range`: `wau` / `mau` are those last seen within 7 / 30 days before `range.to`, so a `range`
  shorter than 30 days caps `mau` at the subjects in that range. `dau` is the rounded mean of the
  `trend`, which has one entry per `granularity` bucket that has a subject (empty buckets are left
  out of both; per hour with `"hour"`), and a subject seen again after
  `range.to` is not counted. Default range: the 30 days before `range.to`.
- `distribution` reads at most 50,000 events, oldest first, then applies `where`; non-numeric
  measure values are ignored. Default `range.from` is 0.
- `list` has no page-size cap (`numItems` is read as given); events that share the exact `ts`
  at a page boundary can be skipped.
- `retentionDays` (default 90) and `sessionIdleMs` (default 30 minutes) take effect only after
  `configure`; until then the crons use the defaults. `configure` also stores `sampleRate`,
  but nothing reads it: `track` uses the client's `sampleRate`.
- `dedupeKey` matches only retained raw events: after `prune` deletes the first event, the same
  key tracks again.
- `prune` runs every 24 hours and `closeSessions` every 30 minutes; each deletes or closes at
  most 500 rows per run and reschedules itself, and they page through scopes 100 at a time.
- `backfill` reads at most 50,001 events and throws if there are more than 50,000.
- REST routes exist only when the component is mounted with `httpPrefix` (it must start with
  `/`). `GET /metric` ignores `dim` without `val` (and the reverse). `POST /track` ignores a
  `ts`, `subjectRef`, `sessionRef`, `dedupeKey` or `sampleRate` of the wrong type instead of
  rejecting it.
- REST `scope`: a value that is not a string, or is `""`, silently becomes `"default"`, so the
  request is checked against and writes to the `"default"` scope.
- `POST /track` rejects invalid JSON and a non-object body with 400 before it checks the API
  key; the other body checks run after the key check.
- `@convex-dev/aggregate` is mounted as a child component but nothing writes or reads it.
- Peer warnings: `@convex-dev/aggregate` 0.3.4 pins `convex-helpers@0.1.128` (peer
  `convex ^1.46.0`), so `convex` 1.45 always warns although this package's peer is `^1.45.0`.
  `@convex-dev/batch-worker` accepts a range of `convex-helpers` versions, and newer ones may ask
  for a higher `convex` (`convex-helpers` 0.1.137 asks for `^1.49.0`).
- Importing `@vllnt/convex-analytics/convex.config` in plain Node fails with
  `ERR_MODULE_NOT_FOUND` inside `@convex-dev/batch-worker`; the Convex CLI bundler loads it fine.
- `@vllnt/convex-analytics/test` is TypeScript source that calls `import.meta.glob`: run it
  under Vitest (or Vite) with `convex-test`.

## Compatibility

- `convex`: peer `^1.45.0`, required. `convex` 1.45.0 itself requires Node 20 or later.
- `react`: peer `>=18.0.0`, optional; only `@vllnt/convex-analytics/react` imports React. A
  transitive dependency (`@convex-dev/batch-worker` 0.3.3, via `@convex-dev/aggregate`) declares
  `react` as a required peer, so package managers may install it in a backend-only app.
- Node: `engines` is `>=18`.
- ESM only; there is no CommonJS build.
- The component's functions run in Convex's default runtime. `./web` helpers are plain
  host-side functions with no dependencies. `./react` hooks need a `ConvexProvider`.
- CI type-checks the README and docs examples against `convex` 1.45.0.

## Testing

Run the repository's tests:

```bash
pnpm test
```

Test host code that uses the component with `convex-test` under Vitest:

```ts
// convex/analytics.test.ts
import analyticsTest from "@vllnt/convex-analytics/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("signups are counted by plan", async () => {
  const t = convexTest(schema, modules);
  analyticsTest.register(t);
  await t.mutation(api.analytics.signup, { userId: "u1", plan: "pro" });
  expect(await t.query(api.analytics.signupsByPlan, {})).toEqual([{ value: "pro", count: 1 }]);
});
```

`register(t, name?)` registers the component under `name` (default `"analytics"`) and its
child components under `<name>/aggregate`, `<name>/shardedCounter` and `<name>/rateLimiter`.

## Security

- The component reads no auth. The host gates every call and passes opaque `subjectRef` /
  `sessionRef` strings in.
- Component tables are sandboxed: the host reaches them only through the exported functions.
- REST routes require an `x-api-key` header, compared against the scope's `apiKeys` config
  with a loop that does not stop at the first differing character (it returns early only when
  the lengths differ). Store keys from a trusted internal mutation; never ship them to a browser.
- Invalid input is rejected with a typed `ConvexError` (see [Errors and fixes](#errors-and-fixes)).
- The component never logs event data. Props and refs are stored as given, so keep personal
  data out of them; the web preset stores `path`, `referrer` and geo headers as received.

See [docs/architecture.md](docs/architecture.md) and [SECURITY.md](https://github.com/vllnt/convex-analytics/blob/main/SECURITY.md).

## Related packages

No public @vllnt package depends on, is tested with, or has an example using this package today.

## Contributing

See [CONTRIBUTING.md](https://github.com/vllnt/convex-analytics/blob/main/CONTRIBUTING.md).

## Links

- Docs and changelog: [oss.vllnt.com/packages/convex-analytics](https://oss.vllnt.com/packages/convex-analytics) · [release feed](https://oss.vllnt.com/packages/convex-analytics/rss.xml)
- All @vllnt packages: [oss.vllnt.com](https://oss.vllnt.com) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)
- Source and issues: [GitHub](https://github.com/vllnt/convex-analytics) · [issues](https://github.com/vllnt/convex-analytics/issues) · [npm](https://www.npmjs.com/package/@vllnt/convex-analytics)
- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)
- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)
- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)

## License

MIT. See [LICENSE](LICENSE).

---

Part of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/convex-analytics) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)
