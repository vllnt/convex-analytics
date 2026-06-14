# Multi-Product Scoping

Every table, mutation, and query is partitioned by a single opaque `scope` string. Use it to
isolate products, environments, tenants, or platforms — whatever partition your host needs.

| Concept | Field | Default |
|---------|-------|---------|
| Partition | `scope` | `"default"` |

## How scoping works

### Set a default scope on the client

```ts
const analytics = new AnalyticsClient(components.analytics, {
  scope: "my-saas",
  dimensions: ["plan"],
});
```

### Override per call

```ts
await analytics.track(ctx, "signup", { subjectRef: userId, scope: "customer-a" });
const total = await analytics.metric(ctx, "signup", { scope: "customer-a" });
```

Every read takes the same `scope` option; omit it to fall back to the client's default.

## What scope isolates

- `events`, `rollups`, `subjects`, `sessions`, and `config` rows are keyed by `scope`.
- All indexes lead with `scope`, so reads never span partitions.
- The sharded counter and aggregate namespaces are `scope:name`, so totals are per-scope.
- `configure` persists retention/sampling/idle per scope.

## Patterns

**Per-tenant SaaS** — one `scope` per customer:

```ts
await analytics.track(ctx, "feature_used", { subjectRef: userId, scope: "customer-a" });
const used = await analytics.metric(ctx, "feature_used", { scope: "customer-a" });
```

**Environment split** — separate staging from production:

```ts
const scope = process.env.CONVEX_ENV === "production" ? "prod" : "staging";
await analytics.track(ctx, "signup", { scope });
```

**Platform split** — compare web vs mobile by scope, or keep one scope and break down on a
`platform` prop dimension instead.

## Mounting vs scope

For a **static** set of partitions (web + mobile + file analytics), you can also mount the
component multiple times (`app.use(analytics, { name })`) — each mount is fully sandboxed.
Reach for `scope` when partitions are **runtime-created** (a new tenant you can't declare at
deploy time).
