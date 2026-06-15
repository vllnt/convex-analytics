# REST API

A lean, generic HTTP surface. Routes are namespaced under the host's chosen `httpPrefix`
when the component is mounted with one. Every route requires an `x-api-key` header matching
the JSON-array config at `(scope, "apiKeys")`, compared timing-safe.

Source: `packages/convex-analytics/src/component/http.ts`.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | /track | Ingest an event |
| GET | /metric | Total count |
| GET | /top | Dimension breakdown |
| GET | /timeseries | Bucketed counts |
| GET | /uniques | DAU / WAU / MAU |

## POST /track

Ingest one event.

**Body** (JSON):

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| `name` | Yes | string | Event name. |
| `dimensions` | Yes | string[] | Prop keys to roll up on. |
| `subjectRef` | No | string | Opaque subject id. |
| `sessionRef` | No | string | Opaque session id. |
| `props` | No | object | Flat scalar props. |
| `ts` | No | number | Event time (epoch ms). |
| `dedupeKey` | No | string | Idempotency key. |
| `granularities` | No | string[] | `["minute" \| "hour" \| "day"]`. Default `["day"]`. |
| `sampleRate` | No | number | `0..1`. |
| `scope` | No | string | Partition. Default `"default"`. |

**Response**: `201` with `{ "result": "tracked" | "dropped" | "duplicate" }`.

## GET /metric

| Param | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Event name. |
| `from`, `to` | No | Range bounds (epoch ms). |
| `dim`, `val` | No | Filter to one dimension value (both required together). |
| `scope` | No | Partition. |

**Response**: `{ "name": "...", "count": N }`.

## GET /top

| Param | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Event name. |
| `dimension` | Yes | Dimension key to break down by. |
| `from`, `to` | No | Range bounds (epoch ms). |
| `limit` | No | Max rows (default 20, max 100). |
| `scope` | No | Partition. |

**Response**: `[{ "value": "...", "count": N }, ...]`.

## GET /timeseries

| Param | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Event name. |
| `granularity` | No | `minute` \| `hour` \| `day` (default `day`). |
| `from`, `to` | No | Range bounds (epoch ms). |
| `scope` | No | Partition. |

**Response**: `[{ "bucket": N, "count": N }, ...]`.

## GET /uniques

| Param | Required | Description |
|-------|----------|-------------|
| `granularity` | No | `minute` \| `hour` \| `day` (default `day`). |
| `from`, `to` | No | Range bounds (epoch ms). |
| `scope` | No | Partition. |

**Response**: `{ "dau": N, "wau": N, "mau": N, "trend": [{ "bucket": N, "uniques": N }] }`.

## Auth & errors

- Configure keys by writing a JSON string array to config `(scope, "apiKeys")` (the `apiKeys` config key).
- Missing or invalid key → `401 { "error": "..." }`.
- Bad input → `400 { "error": "..." }`.

> `funnel`, `retention`, and raw `list` are exposed through the client SDK and component
> functions, not the REST surface. The earlier web-locked routes (events/count/summary,
> funnel, retention, breakdown, attribution, lifecycle, stickiness, live, search, user,
> session, GDPR delete, alias, schemas, config) no longer exist.
