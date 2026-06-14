# Quick Start

Get generic analytics running in your Convex app in a few minutes.

## 1. Install

```bash
npm install @vllnt/convex-analytics
# or: pnpm add @vllnt/convex-analytics
```

## 2. Mount the component

In your `convex/convex.config.ts`:

```ts
import { defineApp } from "convex/server";
import analytics from "@vllnt/convex-analytics/convex.config";

const app = defineApp();
app.use(analytics);
export default app;
```

## 3. Create a client

```ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { components } from "./_generated/api";

type MyProps = { plan?: string; country?: string };

const analytics = new AnalyticsClient<MyProps>(components.analytics, {
  dimensions: ["plan", "country"], // host-declared rollup keys
  granularities: ["day"],
});
```

`TProps` types the `props` you pass to `track`. See [Client SDK](./client-sdk.md) for the
full config and verb reference.

## 4. Track your first event

Inside a Convex mutation:

```ts
await analytics.track(ctx, "signup", {
  subjectRef: userId,
  props: { plan: "pro", country: "FR" },
});
```

Event names are free strings; `subjectRef` / `sessionRef` are opaque to the component.

## 5. Read

```ts
const total = await analytics.metric(ctx, "signup");
const byPlan = await analytics.top(ctx, "signup", "plan");
const trend = await analytics.timeseries(ctx, "signup", {
  granularity: "day",
  range: { from: Date.now() - 30 * 86_400_000, to: Date.now() },
});
```

## 6. (Optional) REST access

Configure API keys, then call the REST surface:

```ts
// In a Convex mutation, via the client's configSet (or component config mutation)
await ctx.runMutation(components.analytics.mutations.configSet, {
  scope: "default",
  key: "apiKeys",
  value: JSON.stringify(["your-key"]),
});
```

```bash
curl -H "x-api-key: your-key" \
  "https://your-deployment.convex.site/metric?name=signup"
```

See the [REST API](./api-reference.md) for all five routes.

## 7. (Optional) Web preset

```ts
import { webDimensions, trackPageview } from "@vllnt/convex-analytics/web";

const web = new AnalyticsClient(components.analytics, { dimensions: webDimensions });
await trackPageview(web, ctx, { path: "/pricing", headers: request.headers });
```

See [Web Preset](./web-preset.md).

## 8. (Optional) MCP for Claude Code

```bash
claude mcp add convex-analytics-mcp \
  --env CONVEX_URL=https://your-deployment.convex.cloud \
  --env ANALYTICS_API_KEY=your-key
```

Gives Claude Code 7 analytics tools. See [MCP Tools](./mcp-tools.md).

## 9. Testing

```ts
import analyticsTest from "@vllnt/convex-analytics/test";
import { convexTest } from "convex-test";

const t = convexTest(hostSchema, hostModules);
analyticsTest.register(t);
```

## Next steps

- [Client SDK](./client-sdk.md) — full config + verb reference
- [Schema](./schema.md) — the five sandboxed tables
- [Web Preset](./web-preset.md) — opt-in web dimensions + helpers
