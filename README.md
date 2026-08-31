<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-analytics.svg)](https://www.npmjs.com/package/@vllnt/convex-analytics)
[![CI](https://github.com/vllnt/convex-analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-analytics/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-analytics.svg)](LICENSE)

# @vllnt/convex-analytics

A generic, configurable, embedded analytics component for Convex — any event,
any dimension, any domain — with rollup-on-write so reads stay O(1).

```ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { components } from "./_generated/api";

const analytics = new AnalyticsClient(components.analytics, {
  dimensions: ["plan", "country"], // prop keys to roll up on
});

await analytics.track(ctx, "signup", { subjectRef: userId, props: { plan: "pro", country: "FR" } });
const byPlan = await analytics.top(ctx, "signup", "plan"); // [{ value: "pro", count: 1 }]
```

## Features

- **Generic events** — free-string event name, opaque `subjectRef` / `sessionRef`, host-typed `props`.
- **Host-declared dimensions** — you pass the prop keys to roll up on; nothing is hardcoded.
- **Rollup-on-write** — counts are incremented as events land, so `metric` / `top` / `timeseries` read in O(1) (backed by `@convex-dev/aggregate` + `@convex-dev/sharded-counter`).
- **Rich verb set** — `metric`, `top`, `timeseries`, `uniques`, `funnel`, `retention`, `distribution`, plus paginated raw `list`.
- **Configurable** — `scope`, `dimensions`, `granularities`, `retentionDays`, `sampleRate`, `propsValidator`; sensible defaults, zero config required.
- **Per-session rate limiting + dedupe + sampling** built into `track`.
- **Opt-in web preset** — `@vllnt/convex-analytics/web` adds web dimensions + UA/geo helpers when you want them.
- **Optional React hooks** — `@vllnt/convex-analytics/react` for reactive aggregate reads.
- **Zero hardcoded domain** — no `v.any()`, no baked-in web fields; the host owns meaning and auth.

## Generic core vs web preset

The core is domain-neutral: it knows nothing about web, mobile, or any vertical.
Web analytics — pageview dimensions (`path`, `referrer`, `device`, `browser`, `os`,
`country`, UTM) plus `parseUserAgent` / `geoFromHeaders` / `trackPageview` helpers —
lives in the opt-in `@vllnt/convex-analytics/web` preset. You turn it on by passing
`webDimensions` to the client's `dimensions` config; otherwise the core ships no web
fields. See [docs/web-preset.md](docs/web-preset.md).

## Installation

```bash
npm install @vllnt/convex-analytics
```

## Usage

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import analytics from "@vllnt/convex-analytics/convex.config";

const app = defineApp();
app.use(analytics);
export default app;
```

```ts
// convex/analytics.ts — track + read, server-side
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { components } from "./_generated/api";

type MyProps = { plan?: string; country?: string };

const analytics = new AnalyticsClient<MyProps>(components.analytics, {
  dimensions: ["plan", "country"],
  granularities: ["day"],
});

await analytics.track(ctx, "signup", { subjectRef: userId, props: { plan: "pro" } });
const total = await analytics.metric(ctx, "signup");
```

## Config

Passed to the `AnalyticsClient` constructor. All optional — the defaults work with zero config.

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `scope` | `string` | `"default"` | Multi-tenant partition; isolates one tenant's data. |
| `dimensions` | `string[]` | `[]` | Prop keys to roll up on (drives rollup-on-write). Empty = count by event name only. |
| `granularities` | `("minute" \| "hour" \| "day")[]` | `["day"]` | Rollup bucket sizes (`minute` for short live windows). |
| `retentionDays` | `number` | `90` | Raw-event TTL in days (rollups are kept forever). Applied via `configure`. |
| `sampleRate` | `number` | `1` | Fraction `0..1` of events to keep at ingest. |
| `sessionIdleMs` | `number` | `1800000` | Idle timeout before a session is closed. Applied via `configure`. |
| `propsValidator` | Convex validator | typed scalar record | Optional host validator narrowing `props` at the boundary. |

`scope`, `dimensions`, `granularities`, and `sampleRate` apply per call from the client.
`retentionDays`, `sampleRate`, and `sessionIdleMs` are persisted for the prune/close-sessions
crons by calling `analytics.configure(ctx, { ... })` once.

## API

| Verb | Kind | Purpose |
|------|------|---------|
| `track(ctx, name, opts)` | mutation | Ingest an event; rollup-on-write + raw event + counter. Returns `"tracked" \| "dropped" \| "duplicate"`. |
| `metric(ctx, name, opts)` | query | Total count over a range, optionally filtered by a dimension value. |
| `top(ctx, name, dimension, opts)` | query | Top values of a dimension (breakdown). |
| `timeseries(ctx, name, opts)` | query | Bucketed counts over a range. |
| `uniques(ctx, opts)` | query | DAU / WAU / MAU from subjects. |
| `funnel(ctx, steps, opts)` | query | Ordered step conversion, keyed by `subjectRef`. |
| `retention(ctx, opts)` | query | Cohort return rates by first-seen period. |
| `distribution(ctx, name, measure, opts)` | query | Histogram of a numeric measure over declared buckets + overflow (with `count` / `sum`). |
| `list(ctx, name, paginationOpts, opts)` | query | Paginated raw events, newest first. |
| `configure(ctx, opts)` | mutation | Persist cron-relevant config (retention / sampling / idle). |

Full reference: [docs/client-sdk.md](docs/client-sdk.md). REST surface: [docs/api-reference.md](docs/api-reference.md).

## What it serves

The Convex-native, authoritative in-app aggregate layer — predefined-dimension rollups served
**reactively** in O(1). It complements a product-analytics warehouse; it doesn't replace one.
Declare the dimensions and measures you'll query and the rollups answer instantly; ad-hoc or
retroactive questions over **non-declared** dimensions, or beyond the raw-event retention window,
are an export concern. `metric` / `top` / `timeseries` read pre-aggregated rollups (kept forever);
`funnel` / `retention` / `distribution` read raw events in range (index-backed, bounded, TTL-pruned).

## Web preset

```ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { webDimensions, trackPageview } from "@vllnt/convex-analytics/web";

const analytics = new AnalyticsClient(components.analytics, { dimensions: webDimensions });

await trackPageview(analytics, ctx, {
  path: "/pricing",
  ua: request.headers.get("user-agent") ?? undefined,
  headers: request.headers,
});
```

`webDimensions` opts the rollups into `path` / `referrer` / `device` / `browser` / `os` /
`country` / UTM; `parseUserAgent` and `geoFromHeaders` build those props from a request.
See [docs/web-preset.md](docs/web-preset.md).

## React

```tsx
import { useMetric, useTop } from "@vllnt/convex-analytics/react";
import { api } from "../convex/_generated/api";

const signups = useMetric(api.analytics.metric, { name: "signup" });
const byPlan = useTop(api.analytics.top, { name: "signup", dimension: "plan" });
```

Thin reactive wrappers over the host's re-exported query refs (`metric`, `top`, `timeseries`,
`uniques`). `react` + `convex` are optional peer deps; backend-only consumers pull no React.

## Security

- Auth-agnostic mount — the host gates access and passes opaque `subjectRef` / `sessionRef` in.
- Tables are sandboxed; the host reaches them only through the exported functions.
- REST endpoints require an `x-api-key` header, compared timing-safe.

See [docs/architecture.md](docs/architecture.md).

## Testing

```bash
pnpm test
```

```ts
import analyticsTest from "@vllnt/convex-analytics/test";
import { convexTest } from "convex-test";

const t = convexTest(hostSchema, hostModules);
analyticsTest.register(t);
```

## Documentation

[Schema](docs/schema.md) · [Client SDK](docs/client-sdk.md) · [REST API](docs/api-reference.md) ·
[Web Preset](docs/web-preset.md) · [Multi-Product](docs/multi-product.md) ·
[Architecture](docs/architecture.md). For AI agents:
[`llms.txt`](llms.txt) · [`llms-full.txt`](llms-full.txt).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
