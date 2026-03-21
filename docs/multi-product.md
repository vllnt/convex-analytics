# Multi-Product Scoping

## Overview

convex-analytics supports multi-product analytics via three scoping fields:

| Field | Purpose | Default |
|-------|---------|---------|
| projectId | Separate products/apps | "default" |
| env | Environments (production, staging, dev) | "default" |
| platform | Platforms (web, ios, android) | "default" |

## How Scoping Works

### Track

Pass scoping fields in `TrackMetadata`:

```typescript
await analytics.track(ctx, userId, sessionId, "signup", { plan: "pro" }, {
  projectId: "my-saas",
  env: "production",
  platform: "web",
});
```

Via REST:

```bash
curl -X POST -H "x-api-key: key" \
  -d '{"userId":"u1","sessionId":"s1","name":"signup","projectId":"my-saas","env":"production","platform":"web"}' \
  https://your.convex.site/api/analytics/track
```

Defaults: All three default to `"default"` if omitted.

### Query

All GET endpoints accept `?projectId=X&env=Y&platform=Z` as query parameters.

When specified:
- Events are filtered by the scoping fields
- Rollups are partitioned by projectId + env
- Sessions carry the scoping fields from their first event

When omitted: returns data across all scopes.

## Data Partitioning

- **daily_rollups** are keyed by `name + projectId + env + date`
- Each rollup row is scoped -- no cross-project contamination
- `users.projectIds` is an array tracking all projects a user has events in

## Use Cases

**Multi-tenant SaaS**: Each customer gets a `projectId`. Dashboard shows per-customer analytics.

```typescript
// Track for customer A
await analytics.track(ctx, userId, sessionId, "feature_used", {}, { projectId: "customer-a" });

// Query for customer A only
const events = await analytics.list(ctx, "feature_used", { projectId: "customer-a" });
```

**Staging vs Production**: Use `env` to separate test data.

```typescript
await analytics.track(ctx, userId, sessionId, "signup", {}, {
  env: process.env.CONVEX_ENV === "production" ? "production" : "staging",
});
```

**Web vs Mobile**: Use `platform` to compare platforms.

```typescript
// React web app
await analytics.track(ctx, userId, sessionId, "page_view", {}, { platform: "web" });

// React Native mobile app
await analytics.track(ctx, userId, sessionId, "screen_view", {}, { platform: "ios" });
```

**Cross-project users**: A user who appears in multiple products has all projectIds in their `user.projectIds` array. The `alias()` function merges projectIds across user records.
