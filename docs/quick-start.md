# Quick Start

Get analytics running in your Convex app in under 5 minutes.

## 1. Install

```bash
npm install @vllnt/convex-analytics
# or
pnpm add @vllnt/convex-analytics
# or
yarn add @vllnt/convex-analytics
```

## 2. Mount the component

In your `convex/convex.config.ts`:

```typescript
import { defineApp } from "convex/server";
import analytics from "@vllnt/convex-analytics/convex.config";

const app = defineApp();
app.use(analytics);
export default app;
```

## 3. Create a typed client

```typescript
import { ConvexAnalytics } from "@vllnt/convex-analytics";
import { components } from "./_generated/api";

// Untyped (zero friction) — accepts any event name and properties
const analytics = new ConvexAnalytics(components.analytics);

// Typed (compile-time safety) — enforces event names and property shapes
type MyEvents = {
  signup: { plan: "free" | "pro" };
  page_view: { path: string };
  purchase: { amount: number; currency: string };
};
const analytics = new ConvexAnalytics<MyEvents>(components.analytics);
```

See [Client SDK](./client-sdk.md) for the full API reference.

## 4. Track your first event

Inside a Convex mutation:

```typescript
await analytics.track(ctx, userId, sessionId, "signup", { plan: "pro" });
```

Event names must match `/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/`.

## 5. Configure API keys for REST access

Set API keys via the Convex dashboard environment variables, or programmatically in a mutation:

```typescript
// In a Convex mutation
await ctx.db.insert("config", {
  key: "api_keys",
  value: JSON.stringify(["your-key"]),
});
```

## 6. REST API first call

```bash
curl -H "x-api-key: your-key" \
  https://your-deployment.convex.site/api/analytics/summary
```

The REST API exposes 24 routes. See the API reference for the full list.

## 7. MCP setup for Claude Code

```bash
claude mcp add convex-analytics-mcp \
  --env CONVEX_URL=https://your-deployment.convex.cloud \
  --env ANALYTICS_API_KEY=your-key
```

This gives Claude Code 12 analytics tools via the MCP server.

## 8. Testing with convex-test

```typescript
import analyticsTest from "@vllnt/convex-analytics/test";
import { convexTest } from "convex-test";

function initTest() {
  const t = convexTest();
  analyticsTest.register(t);
  return t;
}
```

## Next steps

- [Client SDK](./client-sdk.md) -- full TypeScript API reference
- `packages/convex-analytics/src/component/api.ts` -- REST endpoint source
- `packages/convex-analytics-mcp/src/server.ts` -- MCP server source
