# Client SDK

TypeScript API reference for the `ConvexAnalytics<T>` class.

Source: `packages/convex-analytics/src/client.ts`

## Constructor

```typescript
new ConvexAnalytics(component: unknown, config?: ConvexAnalyticsConfig)
```

The `component` argument comes from `components.analytics` after mounting.

### ConvexAnalyticsConfig

```typescript
interface ConvexAnalyticsConfig {
  retentionDays?: number;
  rateLimitPerMin?: number;
  apiKeys?: string[];
}
```

## Typed vs Untyped Usage

**Untyped** -- accepts any event name and any properties object:

```typescript
const analytics = new ConvexAnalytics(components.analytics);
await analytics.track(ctx, userId, sessionId, "anything", { any: "props" });
```

**Typed** -- compile-time enforcement of event names and property shapes:

```typescript
type MyEvents = {
  signup: { plan: "free" | "pro" };
  page_view: { path: string };
  purchase: { amount: number; currency: string };
};

const analytics = new ConvexAnalytics<MyEvents>(components.analytics);

// OK
await analytics.track(ctx, userId, sessionId, "signup", { plan: "pro" });

// Type error: "unknown_event" is not a key of MyEvents
await analytics.track(ctx, userId, sessionId, "unknown_event", {});

// Type error: plan must be "free" | "pro"
await analytics.track(ctx, userId, sessionId, "signup", { plan: "enterprise" });
```

## Methods

### track

```typescript
async track<K extends keyof TEvents & string>(
  ctx: MutationCtx,
  userId: string,
  sessionId: string,
  name: K,
  properties?: TEvents[K],
  metadata?: TrackMetadata,
): Promise<void>
```

Core event ingestion. Writes an event record, updates the sharded counter, and manages session lifecycle.

- `K` is constrained to event names in `TEvents` when typed.
- `properties` are validated against `event_schemas` if a schema is registered for the event name. Unknown properties are silently dropped; type mismatches are silently dropped.
- Event names must match `/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/`.
- Rate-limited per sessionId (100/min, burst 10). Excess events are silently dropped.

### identify

```typescript
async identify(
  ctx: MutationCtx,
  userId: string,
  traits?: Record<string, unknown>,
): Promise<void>
```

Update user profile traits (device, browser, os, locale, country, etc.). No-op if the userId does not exist yet.

### alias

```typescript
async alias(
  ctx: MutationCtx,
  anonymousId: string,
  identifiedId: string,
): Promise<void>
```

Merge an anonymous user into an identified user:

- Reassigns all events and sessions from `anonymousId` to `identifiedId` (paginated, 500/batch).
- Merges user records: `firstSeen` takes min, `lastSeen` takes max, counts are summed.
- Self-alias (same ID for both) is a no-op.

### count

```typescript
async count(
  ctx: QueryCtx,
  name: keyof TEvents & string,
  opts?: QueryOpts,
): Promise<number>
```

Returns the event count for a given event name.

- Without time bounds: uses the sharded counter (O(shards), not O(n)).
- With `from`/`to`: uses daily rollups for the bounded range.

### list

```typescript
async list(
  ctx: QueryCtx,
  name: keyof TEvents & string,
  opts?: PaginationOpts,
): Promise<PaginatedResult<unknown>>
```

Paginated event listing. Supports scoping by `projectId`, `env`, and `platform`.

### summary

```typescript
async summary(
  ctx: QueryCtx,
  opts?: { projectId?: string },
): Promise<SummaryItem[]>
```

Returns all event names with their counts, sorted descending. Optionally scoped to a `projectId`.

### debug

```typescript
debug(enabled: boolean): void
```

Enable or disable console logging of `track()` calls. Useful during development.

## Types

### TrackMetadata

All fields are optional.

| Field | Type | Default |
|-------|------|---------|
| projectId | `string` | `"default"` |
| env | `string` | `"default"` |
| platform | `string` | `"default"` |
| timestamp | `number` | `Date.now()` |
| path | `string` | `"unknown"` |
| locale | `string` | `"unknown"` |
| referrer | `string` | `""` |
| device | `string` | `"unknown"` |
| browser | `string` | `"unknown"` |
| os | `string` | `"unknown"` |
| country | `string` | `"unknown"` |
| region | `string \| null` | -- |
| city | `string \| null` | -- |
| utmSource | `string \| null` | -- |
| utmMedium | `string \| null` | -- |
| utmCampaign | `string \| null` | -- |

### Dimension

Union type used for breakdown queries:

```typescript
type Dimension =
  | "locale" | "path" | "device" | "browser" | "os"
  | "country" | "referrer" | "utmSource" | "utmMedium"
  | "utmCampaign" | "projectId" | "env" | "platform";
```

### QueryOpts

```typescript
interface QueryOpts {
  from?: number;    // epoch ms
  to?: number;      // epoch ms
  projectId?: string;
  env?: string;
  platform?: string;
  compare?: "previous_period";
}
```

### PaginationOpts

```typescript
interface PaginationOpts extends QueryOpts {
  limit?: number;   // max 100, default 50
  cursor?: string;
}
```

### PaginatedResult

```typescript
interface PaginatedResult<T> {
  data: T[];
  hasMore: boolean;
  cursor: string | null;
}
```

### SummaryItem

```typescript
interface SummaryItem {
  name: string;
  count: number;
}
```
