# Multi-product scoping

Every table, mutation and query is partitioned by one opaque `scope` string. Use it to keep
products, environments or tenants apart.

| Concept   | Field   | Default     |
| --------- | ------- | ----------- |
| Partition | `scope` | `"default"` |

## Default scope and per-call override

Set a default on the client; every method also takes `scope` in its options.

```ts
// convex/tenants.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics, {
  scope: "my-saas",
  dimensions: ["plan"],
});

export const featureUsed = mutation({
  args: { tenantId: v.string(), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, { tenantId, userId }) => {
    await analytics.track(ctx, "feature_used", { subjectRef: userId, scope: tenantId });
    return null;
  },
});

export const featureUses = query({
  args: { tenantId: v.string() },
  returns: v.number(),
  handler: async (ctx, { tenantId }) =>
    await analytics.metric(ctx, "feature_used", { scope: tenantId }),
});
```

## What scope isolates

- `events`, `rollups`, `subjects`, `sessions`, `scopes` and `config` rows carry `scope`, and
  every index starts with it, so a read for one scope never returns another scope's rows.
- The lifetime counter is keyed by `(scope, name)`.
- `configure` stores `retentionDays` and `sessionIdleMs` per scope, and REST `apiKeys` are
  stored per scope.
- The crons visit every scope that has tracked an event or has config (the `scopes` table).

The component does not check who may read a scope: your functions decide which `scope` a
caller may pass.

## Mounting twice instead of scoping

For a fixed set of partitions known at deploy time, you can mount the component more than once.
Each mount has its own tables and crons. Use `scope` when partitions are created at runtime
(a new tenant).

```ts
// convex/convex.config.ts
import analytics from "@vllnt/convex-analytics/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(analytics);
app.use(analytics, { name: "mobileAnalytics" });
export default app;
```

```ts
// convex/mobile.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";

import { components } from "./_generated/api";

export const mobileAnalytics = new AnalyticsClient(components.mobileAnalytics);
```
