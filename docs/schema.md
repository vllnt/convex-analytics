# Database Schema

Five sandboxed tables. Generic and domain-neutral — zero hardcoded web fields, zero
`v.any()`. Schema source of truth:
`packages/convex-analytics/src/component/schema.ts`.

## events

Raw event log. One row per tracked event. TTL-pruned past `retentionDays` (rollups are
kept forever).

| Field | Type | Description |
|-------|------|-------------|
| `scope` | string | Multi-tenant partition. Default `"default"`. |
| `name` | string | Free-string event name (e.g. `"signup"`, `"page_view"`). |
| `subjectRef` | string? | Opaque subject identifier (user id, device id, …). |
| `sessionRef` | string? | Opaque session identifier. |
| `props` | record<string, scalar> | Flat host props. Scalar = string \| number \| boolean \| null. |
| `ts` | number | Event time (epoch ms). |
| `seq` | number | Sequence within the session (derived from `session.eventCount`). |
| `dedupeKey` | string? | Optional idempotency key. |

**Indexes:**

| Index | Fields | Purpose |
|-------|--------|---------|
| `by_scope_name_ts` | [scope, name, ts] | Primary query path; funnel, list, prune. |
| `by_scope_subject_ts` | [scope, subjectRef, ts] | Per-subject reads. |
| `by_scope_session_ts` | [scope, sessionRef, ts] | Per-session reads. |
| `by_dedupe` | [scope, dedupeKey] | Dedupe lookup at ingest. |

## rollups

Pre-aggregated counts, incremented on write. One row per
`(scope, name, granularity, bucket, dim, val)`. The row with `dim = ""` and `val = ""` is
the **total** for that bucket; one row per host-declared dimension value present in `props`.

| Field | Type | Description |
|-------|------|-------------|
| `scope` | string | Partition. |
| `name` | string | Event name. |
| `granularity` | "hour" \| "day" | Bucket size. |
| `bucket` | number | Bucket start (epoch ms, truncated to granularity). |
| `dim` | string | Dimension key (`""` = total). |
| `val` | string | Dimension value (`""` = total). |
| `count` | number | Events in this bucket/dimension. |

**Indexes:**

| Index | Fields | Purpose |
|-------|--------|---------|
| `by_scope_name_gran_bucket_dim` | [scope, name, granularity, bucket, dim, val] | metric / top / timeseries reads, on-write upsert. |
| `by_scope_name_dim_val` | [scope, name, dim, val] | Backfill / dimension scans. |

## subjects

Per-subject lifecycle, for uniques and retention. Upserted on every event that carries a
`subjectRef`.

| Field | Type | Description |
|-------|------|-------------|
| `scope` | string | Partition. |
| `subjectRef` | string | Opaque subject identifier. |
| `firstSeen` | number | Earliest event ts. |
| `lastSeen` | number | Latest event ts. |
| `eventCount` | number | Total events for this subject. |

**Indexes:**

| Index | Fields | Purpose |
|-------|--------|---------|
| `by_scope_subject` | [scope, subjectRef] | Direct lookup / upsert. |
| `by_scope_firstSeen` | [scope, firstSeen] | Cohort (retention) and uniques scans. |

## sessions

Optional generic session aggregates. Created when an event carries a `sessionRef`; closed
by the `closeSessions` cron after `sessionIdleMs`.

| Field | Type | Description |
|-------|------|-------------|
| `scope` | string | Partition. |
| `sessionRef` | string | Opaque session identifier. |
| `subjectRef` | string? | Subject the session belongs to, if known. |
| `startTs` | number | First event ts. |
| `endTs` | number? | Set when the session is closed by cron. |
| `lastTs` | number | Latest event ts. |
| `eventCount` | number | Events in the session. |

**Indexes:**

| Index | Fields | Purpose |
|-------|--------|---------|
| `by_scope_session` | [scope, sessionRef] | Direct lookup / upsert. |
| `by_scope_lastTs` | [scope, lastTs] | Idle-session scan for close-sessions cron. |

## config

Cron-relevant config, keyed by `(scope, key)`. Values are stored as strings. Set via
`client.configure(ctx, { ... })`; also holds the REST `apiKeys` array (JSON string).

| Field | Type | Description |
|-------|------|-------------|
| `scope` | string | Partition. |
| `key` | string | Config key (`retentionDays`, `sampleRate`, `sessionIdleMs`, `apiKeys`). |
| `value` | string | String-encoded value. |

**Indexes:**

| Index | Fields | Purpose |
|-------|--------|---------|
| `by_scope_key` | [scope, key] | Direct config lookup. |

## Child components

| Component | Package | Role |
|-----------|---------|------|
| aggregate | `@convex-dev/aggregate` | Range counts, namespaced `scope:name`. |
| shardedCounter | `@convex-dev/sharded-counter` | O(1) total per `scope:name` (16 shards). |
| rateLimiter | `@convex-dev/rate-limiter` | Per-`sessionRef` token bucket at ingest. |
