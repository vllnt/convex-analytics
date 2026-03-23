# convex-analytics

[![npm](https://img.shields.io/npm/v/@vllnt/convex-analytics)](https://www.npmjs.com/package/@vllnt/convex-analytics)
[![CI](https://github.com/bntvllnt/convex-analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/bntvllnt/convex-analytics/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Full-featured API-first analytics engine for [Convex](https://convex.dev). Reusable component — mount via `app.use()` in any Convex app.

**Zero bundle size. Zero external services. AI-native via MCP.**

## Features

- **Events** — track custom events with typed properties, geo, device, UTM
- **Sessions** — auto-created, 30min inactivity timeout, entry/exit paths
- **Users** — anonymous identity, `identify()` traits, `alias()` merge
- **Funnels** — ordered step conversion with time window
- **Retention** — cohort-by-firstSeen, return rates per period
- **Time-series** — daily/weekly/monthly from pre-aggregated rollups
- **Breakdowns** — by locale, country, device, browser, OS, path, referrer
- **Attribution** — traffic source → conversion analysis
- **Lifecycle** — new / returning / dormant / resurrected classification
- **Stickiness** — DAU/MAU engagement ratio
- **MCP Tools** — 12 tools for AI-native analytics via Claude Code
- **Multi-product** — `projectId` + `env` + `platform` scoping

## Quick Start

```bash
npm install @vllnt/convex-analytics
```

```typescript
// convex/convex.config.ts
import { defineApp } from "convex/server";
import analytics from "@vllnt/convex-analytics/convex.config";

const app = defineApp();
app.use(analytics);
export default app;
```

```typescript
// Track events (server-side — zero bundle size)
import { ConvexAnalytics } from "@vllnt/convex-analytics";
import { components } from "./_generated/api";

const analytics = new ConvexAnalytics(components.analytics);

// Untyped (zero friction):
await analytics.track(ctx, userId, sessionId, "signup", { plan: "pro" });

// Typed (compile-time safety):
type MyEvents = {
  signup: { plan: "free" | "pro" };
  page_view: {};
  purchase: { amount: number; currency: string };
};
const typedAnalytics = new ConvexAnalytics<MyEvents>(components.analytics);
await typedAnalytics.track(ctx, userId, sessionId, "signup", { plan: "pro" });
// typedAnalytics.track(ctx, id, sid, "typo") → compile error
```

## REST API

All endpoints require `x-api-key` header.

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analytics/track` | Ingest event (auto-derives geo from headers) |
| GET | `/api/analytics/events?name=X` | List events (paginated) |
| GET | `/api/analytics/count?name=X` | Count events |
| GET | `/api/analytics/summary` | All event counts |
| GET | `/api/analytics/timeseries?name=X&interval=day` | Time-series |
| GET | `/api/analytics/funnel?steps=A,B,C` | Funnel conversion |
| GET | `/api/analytics/retention?event=X` | Cohort retention |
| GET | `/api/analytics/breakdown?name=X&by=country` | Dimension breakdown |
| GET | `/api/analytics/attribution?event=X` | Traffic source analysis |
| GET | `/api/analytics/uniques?period=day` | DAU/WAU/MAU |
| GET | `/api/analytics/lifecycle` | User lifecycle classification |
| GET | `/api/analytics/stickiness` | DAU/MAU ratio |
| GET | `/api/analytics/live` | Real-time event stream |
| GET | `/api/analytics/search?q=X` | Event name search |
| GET | `/api/analytics/user?id=X` | User timeline |
| GET | `/api/analytics/session?id=X` | Session replay |
| DELETE | `/api/analytics/user?id=X` | GDPR deletion |

All GET endpoints support `?projectId=X&env=Y&platform=Z` scoping.

## MCP (Claude Code)

```bash
# Connect to your analytics
claude mcp add convex-analytics-mcp \
  --env CONVEX_URL=https://your-deployment.convex.cloud \
  --env ANALYTICS_API_KEY=your-key
```

Then ask Claude Code:

- "How are signups trending this month?"
- "Show me the onboarding funnel"
- "Break down events by country"
- "Any anomalies this week?"
- "What's our DAU/MAU ratio?"

12 tools: `get_timeseries`, `get_funnel`, `get_retention`, `get_breakdown`, `get_attribution`, `get_user_journey`, `get_session`, `get_live`, `compare_periods`, `get_stickiness`, `detect_anomalies`, `query_analytics` (NL router).

## Architecture

```
track() → rate-limiter → validate → insert event → upsert session
       → upsert user → aggregate (O(log n)) → counter (sharded)

Crons:
  rollup (5min)    → daily_rollups with pre-aggregated dimensions
  session closer   → endTime + duration after 30min inactivity
  TTL cleanup      → archive + delete events past retention period
  monitor          → storage usage warnings
  rebalance        → verify counter accuracy
```

Built on:
- `@convex-dev/aggregate` — O(log n) counts/sums
- `@convex-dev/sharded-counter` — high-throughput writes (16 shards)
- `@convex-dev/rate-limiter` — per-session abuse prevention

## Testing

```bash
pnpm test  # runs all tests across packages
```

For consumer testing:

```typescript
import analyticsTest from "@vllnt/convex-analytics/test";
import { convexTest } from "convex-test";

function initTest() {
  const t = convexTest();
  analyticsTest.register(t);
  return t;
}
```

## Documentation

Full documentation in [`docs/`](docs/):

- [Quick Start](docs/quick-start.md) — install, mount, first event
- [Client SDK](docs/client-sdk.md) — ConvexAnalytics<T> API
- [Schema](docs/schema.md) — tables and indexes
- [REST API](docs/api-reference.md) — all 24 endpoints
- [Architecture](docs/architecture.md) — internals
- [MCP Tools](docs/mcp-tools.md) — AI-native queries
- [Multi-Product](docs/multi-product.md) — scoping

For AI agents: [`llms.txt`](llms.txt) | [`llms-full.txt`](llms-full.txt)

## License

MIT
