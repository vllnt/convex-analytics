# Quick start

Install, mount, track and read events in a Convex app.

## 1. Install

```bash
npm install @vllnt/convex-analytics
# or: pnpm add @vllnt/convex-analytics
```

`convex` (`^1.45.0`) is a required peer dependency.

## 2. Mount the component

```ts
// convex/convex.config.ts
import analytics from "@vllnt/convex-analytics/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(analytics);
export default app;
```

Run `npx convex dev` to generate `components.analytics`.

## 3. Track and read

```ts
// convex/signups.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

type SignupProps = { plan?: string; country?: string };

const analytics = new AnalyticsClient<SignupProps>(components.analytics, {
  dimensions: ["plan", "country"], // props keys to roll up on
});

export const signup = mutation({
  args: { userId: v.string(), plan: v.string(), country: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, plan, country }) => {
    await analytics.track(ctx, "signup", { subjectRef: userId, props: { plan, country } });
    return null;
  },
});

export const summary = query({
  args: { from: v.number(), to: v.number() },
  returns: v.object({
    total: v.number(),
    byPlan: v.array(v.object({ value: v.string(), count: v.number() })),
    daily: v.array(v.object({ bucket: v.number(), count: v.number() })),
  }),
  handler: async (ctx, { from, to }) => ({
    total: await analytics.metric(ctx, "signup"),
    byPlan: await analytics.top(ctx, "signup", "plan"),
    daily: await analytics.timeseries(ctx, "signup", { granularity: "day", range: { from, to } }),
  }),
});
```

Event names are free strings; `subjectRef` and `sessionRef` are opaque to the component. See
[Client SDK](./client-sdk.md) for every option and method.

## 4. (Optional) REST access

Mount with `app.use(analytics, { httpPrefix: "/analytics" })` and deploy; without
`httpPrefix` the component's HTTP routes are not exposed. Store API keys from an internal
mutation (the client has no `configSet` method, so call the component mutation):

```ts
// convex/admin.ts
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

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

```bash
npx convex run admin:setApiKey '{"key":"your-key"}'
curl -H "x-api-key: your-key" \
  "https://<deployment>.convex.site/analytics/metric?name=signup"
```

See the [REST API](./api-reference.md) for all five routes.

## 5. Next steps

- [Client SDK](./client-sdk.md): config, methods, types, test helper
- [Web preset](./web-preset.md): web dimensions, user-agent and geo helpers
- [React hooks](./react.md): reactive aggregate reads
- [Schema](./schema.md): the six component tables
- [Errors and fixes](../README.md#errors-and-fixes)
