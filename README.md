<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-analytics.svg)](https://www.npmjs.com/package/@vllnt/convex-analytics)
[![CI](https://github.com/vllnt/convex-analytics/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-analytics/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-analytics.svg)](LICENSE)

# @vllnt/convex-analytics

API-first analytics engine for Convex — events, sessions, funnels, retention, and a REST + MCP surface, with zero bundle size and zero external services.

```ts
const analytics = new ConvexAnalytics(components.analytics);
await analytics.track(ctx, userId, sessionId, "signup", { plan: "pro" }); // server-side, zero bundle
```

## Features

- **Events** — track custom events with typed properties, geo, device, UTM.
- **Sessions** — auto-created, 30min inactivity timeout, entry/exit paths.
- **Users** — anonymous identity, `identify()` traits, `alias()` merge.
- **Funnels & retention** — ordered step conversion + cohort-by-firstSeen return rates.
- **Time-series & breakdowns** — daily/weekly/monthly rollups; by locale, country, device, OS, path, referrer.
- **Attribution & lifecycle** — traffic source → conversion; new / returning / dormant / resurrected; DAU/MAU stickiness.
- **MCP tools** — 12 tools for AI-native analytics via Claude Code.
- **Multi-product** — `projectId` + `env` + `platform` scoping on every query.

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
// Track events (server-side — zero bundle size)
import { ConvexAnalytics } from "@vllnt/convex-analytics";
import { components } from "./_generated/api";

const analytics = new ConvexAnalytics(components.analytics);

// Untyped (zero friction):
await analytics.track(ctx, userId, sessionId, "signup", { plan: "pro" });

// Typed (compile-time safety):
type MyEvents = {
  signup: { plan: "free" | "pro" };
  purchase: { amount: number; currency: string };
};
const typed = new ConvexAnalytics<MyEvents>(components.analytics);
await typed.track(ctx, userId, sessionId, "signup", { plan: "pro" });
// typed.track(ctx, id, sid, "typo") → compile error
```

## API Reference

The client `ConvexAnalytics<T>` exposes `track`, `identify`, and `alias`; reads run through 18 query
functions and a REST surface of 24 `x-api-key`-authed HTTP endpoints (ingest, events/count/summary,
timeseries, funnel, retention, breakdown, attribution, uniques, lifecycle, stickiness, live, search,
user/session, GDPR delete). All GET endpoints accept `?projectId=X&env=Y&platform=Z` scoping.

Full reference: [docs/api-reference.md](docs/api-reference.md) (REST) · [docs/client-sdk.md](docs/client-sdk.md) (client SDK).

## MCP (Claude Code)

```bash
claude mcp add convex-analytics-mcp \
  --env CONVEX_URL=https://your-deployment.convex.cloud \
  --env ANALYTICS_API_KEY=your-key
```

Then ask Claude Code: "How are signups trending?", "Show me the onboarding funnel", "What's our DAU/MAU
ratio?". 12 tools: `get_timeseries`, `get_funnel`, `get_retention`, `get_breakdown`, `get_attribution`,
`get_user_journey`, `get_session`, `get_live`, `compare_periods`, `get_stickiness`, `detect_anomalies`,
`query_analytics` (NL router). See [docs/mcp-tools.md](docs/mcp-tools.md).

## Security

- Auth-agnostic mount; REST endpoints require an `x-api-key` header, validated with timing-safe comparison.
- Tables sandboxed — the host reaches them only through the exported functions.
- Event names are validated and unknown/mismatched properties are dropped per the event schema.

See [docs/architecture.md](docs/architecture.md).

## Testing

```bash
pnpm test  # runs all tests across packages
```

```ts
import analyticsTest from "@vllnt/convex-analytics/test";
import { convexTest } from "convex-test";

function initTest() {
  const t = convexTest();
  analyticsTest.register(t);
  return t;
}
```

## Documentation

Full docs in [`docs/`](docs/): [Quick Start](docs/quick-start.md) · [Client SDK](docs/client-sdk.md) ·
[Schema](docs/schema.md) · [REST API](docs/api-reference.md) · [Architecture](docs/architecture.md) ·
[MCP Tools](docs/mcp-tools.md) · [Multi-Product](docs/multi-product.md). For AI agents:
[`llms.txt`](llms.txt) · [`llms-full.txt`](llms-full.txt).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
