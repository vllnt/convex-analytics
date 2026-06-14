# Architecture

## Write path — rollup-on-write

`track` does the aggregation as the event lands, so reads stay O(1) (no rollup lag).

```
track(ctx, name, opts)
  |
  +- 1. Rate limit (when sessionRef set: per-session token bucket) -> "dropped" if over
  |
  +- 2. Sampling (when sampleRate < 1) -> "dropped" for the sampled-out fraction
  |
  +- 3. Dedupe (when dedupeKey set + already exists in scope) -> "duplicate"
  |
  +- 4. Insert raw event (seq derived from session.eventCount)
  |
  +- 5. Upsert session (when sessionRef set)
  |
  +- 6. Upsert subject (when subjectRef set: firstSeen/lastSeen/eventCount)
  |
  +- 7. Rollup-on-write: for each granularity bucket, increment the total row
  |     and one row per host-declared dimension present in props
  |
  +- 8. Aggregate insert (namespace "scope:name") + sharded counter increment
  |
  +- return "tracked"
```

Reads come straight from the pre-aggregated `rollups` table (or the sharded counter for an
unbounded total) — `metric`, `top`, and `timeseries` never scan raw events. `funnel`,
`retention`, and `uniques` read the `events` / `subjects` tables directly.

## Child components

| Component | Package | Role |
|-----------|---------|------|
| aggregate | `@convex-dev/aggregate` | Range counts, namespaced `scope:name`. |
| shardedCounter | `@convex-dev/sharded-counter` | O(1) total per `scope:name` (16 shards). |
| rateLimiter | `@convex-dev/rate-limiter` | Per-`sessionRef` token bucket (100/min, burst 10). |

Mounted in `convex.config.ts`:

```ts
const component = defineComponent("analytics");
component.use(aggregate);
component.use(shardedCounter);
component.use(rateLimiter);
```

## Crons

Both run inside the component and are idempotent.

| Cron | Schedule | What it does |
|------|----------|--------------|
| `prune` | Daily | Deletes raw events older than `retentionDays` per scope (rollups kept forever). Capped per run. |
| `closeSessions` | Periodic | Sets `endTs` on sessions idle past `sessionIdleMs`. |

`backfill` is a non-cron internal mutation that re-derives a `(scope, name)`'s rollups from
the retained raw events — useful after changing dimensions.

## Isolation

Tables are sandboxed: the host reaches them only through the exported functions. The
component never reads host or sibling tables. Host data enters only as opaque strings
(`subjectRef`, `sessionRef`) or host-typed scalar `props` — never `v.any()`.
