# Web Preset

An opt-in layer for web analytics. Pure host-side helpers — **not** part of the sandboxed
component. The generic core stays domain-neutral; you turn on web breakdowns by passing
`webDimensions` to the client and using `trackPageview` to ingest page views.

Import: `@vllnt/convex-analytics/web`. Source: `packages/convex-analytics/src/web/index.ts`.

## webDimensions

```ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { webDimensions } from "@vllnt/convex-analytics/web";

const analytics = new AnalyticsClient(components.analytics, { dimensions: webDimensions });
```

`webDimensions` is the standard web rollup set:

```ts
["path", "referrer", "device", "browser", "os", "country", "utmSource", "utmMedium", "utmCampaign"]
```

Pass it to the client's `dimensions` config to roll up on those prop keys. Off by default —
the generic core has zero web fields.

## parseUserAgent

```ts
parseUserAgent(ua: string): { device: string; browser: string; os: string }
```

Pure, dependency-free. Coarse buckets suitable for rollups (not exact versioning). Unknown
agents fall back to `"Other"` / `"desktop"`. Device buckets: `desktop` / `mobile` / `tablet`
/ `bot`.

## geoFromHeaders

```ts
geoFromHeaders(headers: Headers | Record<string, string>): { country: string; region?: string; city?: string }
```

Resolves geo from Cloudflare (`CF-IPCountry`) and Vercel (`X-Vercel-IP-*`) edge headers.
Accepts a DOM `Headers` instance or a plain object (case-insensitive). `country` defaults to
`"unknown"`.

## trackPageview

```ts
trackPageview(client, ctx, {
  path: string;        // required
  subjectRef?: string;
  sessionRef?: string;
  referrer?: string;
  ua?: string;         // parsed into device/browser/os
  headers?: Headers | Record<string, string>; // parsed into country/region/city
  utm?: { source?: string; medium?: string; campaign?: string };
  ts?: number;
  scope?: string;
  dedupeKey?: string;
}): Promise<unknown>
```

Builds `webDimensions`-shaped `props` (parsing UA + geo) and calls
`client.track(ctx, "page_view", { props })`. The component never sees web concepts — this is
host-side convenience only.

```ts
await trackPageview(analytics, ctx, {
  path: "/pricing",
  ua: request.headers.get("user-agent") ?? undefined,
  headers: request.headers,
  utm: { source: "twitter" },
});
```

Then read web breakdowns with the generic verbs:

```ts
await analytics.top(ctx, "page_view", "country");
await analytics.timeseries(ctx, "page_view", { granularity: "day", range });
```

## React

The optional `@vllnt/convex-analytics/react` entry ships reactive hooks over the host's
re-exported aggregate query refs: `useMetric`, `useTop`, `useTimeseries`, `useUniques`. They
wrap `convex/react`'s `useQuery`; `react` and `convex` are optional peer deps, so a
backend-only consumer pulls no React code. Aggregates only (no raw events), every call
scope-gated. See the React section of the README.
