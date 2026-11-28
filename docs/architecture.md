# Architecture

## Write path — rollup-on-write

`track` aggregates as the event lands (no rollup lag). Unfiltered lifetime metrics read a
fixed-shard counter; ranged/filtered metrics, top values, and time series scan matching rollup
rows. They avoid raw-event scans but are not generally O(1).

```text
track(ctx, name, opts)
  |
  +- 1. Rate limit (when sessionRef set: per-session token bucket) -> "dropped" if over
  |
  +- 2. Sampling (when sampleRate < 1) -> "dropped" for the sampled-out fraction
  |
  +- 3. Dedupe (when dedupeKey set + already exists in scope) -> "duplicate"
  |
  +- 4. Register the scope in `scopes` (first event only), insert raw event
  |     (seq derived from session.eventCount)
  |
  +- 5. Upsert session (when sessionRef set)
  |
  +- 6. Upsert subject (when subjectRef set: firstSeen/lastSeen/eventCount)
  |
  +- 7. Rollup-on-write: for each granularity bucket, increment the total row
  |     and one row per host-declared dimension present in props
  |
  +- 8. Sharded counter increment (keyed by (scope, name))
  |
  +- return "tracked"
```

Reads come straight from the pre-aggregated `rollups` table (or the sharded counter for an
unbounded total) — `metric`, `top`, and `timeseries` never scan raw events. `funnel`,
`distribution`, and `list` read the `events` table; `retention` and `uniques` read `subjects`.

## Child components

| Component      | Package                       | Role                                               |
| -------------- | ----------------------------- | -------------------------------------------------- |
| aggregate      | `@convex-dev/aggregate`       | Mounted; not written or read. |
| shardedCounter | `@convex-dev/sharded-counter` | O(1) total per `(scope, name)` (16 shards).        |
| rateLimiter    | `@convex-dev/rate-limiter`    | Per-`sessionRef` token bucket (100/min, burst 10). |

All three are mounted in `src/component/convex.config.ts` with `component.use(...)`.

## Crons

Both run inside the component, are idempotent, and visit every scope in the `scopes` table.

| Cron            | Schedule | What it does                                                                                    |
| --------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `prune`         | 24 hours | Deletes raw events older than `retentionDays` per scope (rollups kept forever). |
| `closeSessions` | 30 min   | Sets `endTs` (to the last event time) on sessions idle past `sessionIdleMs`.     |

Each run handles at most 500 rows per scope and schedules itself again when it hit that cap; scopes
are visited 100 at a time. `retentionDays` and `sessionIdleMs` come from the `config` table
(written by `configure`), else 90 days and 30 minutes.

`backfill` is a non-cron internal mutation that deletes and re-derives a `(scope, name)`'s
rollups from the retained raw events, for example after changing dimensions. It is not part
of the host-facing API; run it with
`npx convex run --component analytics internal_mutations:backfill '{...}'`. It throws when more
than 50,000 raw events exist for the name. It does not change the lifetime counter.

## Isolation

Tables are sandboxed: the host reaches them only through the exported functions. The
component never reads host or sibling tables. Host data enters only as opaque strings
(`subjectRef`, `sessionRef`) or host-typed scalar `props` — never `v.any()`.
