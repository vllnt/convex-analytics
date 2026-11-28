# REST API

A lean, generic HTTP surface. Routes are namespaced under the host's chosen `httpPrefix`
when the component is mounted with one. Every route requires an `x-api-key` header matching
the JSON-array config at `(scope, "apiKeys")`. The comparison does not stop at the first
differing character; it returns early only when the lengths differ.

Mount with `app.use(analytics, { httpPrefix: "/analytics" })`; `/metric` below then means
`https://<deployment>.convex.site/analytics/metric`. Without `httpPrefix`, these routes are not
exposed. See [Quick Start](quick-start.md#4-optional-rest-access) for key setup through the
component's `mutations.configSet` (there is no `AnalyticsClient.configSet` method).

Source: `src/component/http.ts` in the package (`packages/convex-analytics/src/component/http.ts`
in the repository).

## Endpoints

| Method | Path        | Purpose             |
| ------ | ----------- | ------------------- |
| POST   | /track      | Ingest an event     |
| GET    | /metric     | Total count         |
| GET    | /top        | Dimension breakdown |
| GET    | /timeseries | Bucketed counts     |
| GET    | /uniques    | DAU / WAU / MAU     |

## POST /track

Ingest one event.

**Body** (JSON):

| Field           | Required | Type     | Description                                         |
| --------------- | -------- | -------- | --------------------------------------------------- |
| `name`          | Yes      | string   | Event name.                                         |
| `dimensions`    | Yes      | string[] | Prop keys to roll up on.                            |
| `subjectRef`    | No       | string   | Opaque subject id.                                  |
| `sessionRef`    | No       | string   | Opaque session id.                                  |
| `props`         | No       | object   | Flat scalar props.                                  |
| `ts`            | No       | number   | Event time (epoch ms).                              |
| `dedupeKey`     | No       | string   | Idempotency key.                                    |
| `granularities` | No       | string[] | `["minute" \| "hour" \| "day"]`. Default `["day"]`. |
| `sampleRate`    | No       | number   | `0..1`.                                             |
| `scope`         | No       | string   | Partition. Default `"default"`.                     |

`subjectRef`, `sessionRef`, `dedupeKey` (strings) and `ts`, `sampleRate` (numbers) are ignored,
not rejected, when they have another type.

**Response**: `201` with `{ "result": "tracked" | "dropped" | "duplicate" }`.
A 201 does not imply storage: inspect `result`. With `sessionRef`, a fixed token bucket per
`(scope, sessionRef)` refills at 100/minute with capacity 10; exhausted requests return
`"dropped"` (not HTTP 429). Sampling also returns `"dropped"`. No `sessionRef` means no
session rate-limit check.

## GET /metric

| Param        | Required | Description                                             |
| ------------ | -------- | ------------------------------------------------------- |
| `name`       | Yes      | Event name.                                             |
| `from`, `to` | No       | Range bounds (epoch ms).                                |
| `dim`, `val` | No       | Filter to one dimension value. Ignored unless both are set. |
| `scope`      | No       | Partition.                                              |

**Response**: `{ "name": "...", "count": N }`.

## GET /top

| Param        | Required | Description                     |
| ------------ | -------- | ------------------------------- |
| `name`       | Yes      | Event name.                     |
| `dimension`  | Yes      | Dimension key to break down by. |
| `from`, `to` | No       | Range bounds (epoch ms).        |
| `limit`      | No       | Max rows (default 20, max 100). |
| `scope`      | No       | Partition.                      |

**Response**: `[{ "value": "...", "count": N }, ...]`.

## GET /timeseries

| Param         | Required | Description                                  |
| ------------- | -------- | -------------------------------------------- |
| `name`        | Yes      | Event name.                                  |
| `granularity` | No       | `minute` \| `hour` \| `day` (default `day`). |
| `from`, `to`  | No       | Range bounds (epoch ms).                     |
| `scope`       | No       | Partition.                                   |

**Response**: `[{ "bucket": N, "count": N }, ...]`.

## GET /uniques

| Param         | Required | Description                                  |
| ------------- | -------- | -------------------------------------------- |
| `granularity` | No       | `minute` \| `hour` \| `day` (default `day`). |
| `from`, `to`  | No       | Range bounds (epoch ms). Default: the 30 days before `to` (or now). |
| `scope`       | No       | Partition.                                   |

**Response**: `{ "dau": N, "wau": N, "mau": N, "trend": [{ "bucket": N, "uniques": N }] }`.
See [`uniques`](client-sdk.md#uniques) for how each number is computed.

## Auth & errors

- Configure keys by writing a JSON string array to config `(scope, "apiKeys")` (the `apiKeys` config key).
- Missing key, no `apiKeys` for the scope, or a key not in the list → `401 { "error": "..." }`.
- Invalid input returns `400`. Typed errors from the table below (for example a non-numeric
  `from`, `to`, or `limit`, nested or array `props` values, prop keys Convex cannot store)
  return `{ "error": "...", "code": "..." }`. Checks done in the route itself return
  `{ "error": "..." }` without `code`: a body that is not a JSON object, invalid JSON, missing
  `name` / `dimensions` or a required query parameter, `dimensions` that is not a string array,
  `props` that is not an object, and unknown `granularities` / `granularity`.
  Any other failure (for example a Convex argument-validator error) still fails the action.
- A stored `apiKeys` value that is not a JSON array of strings returns `500 { "error": "API keys
misconfigured" }`.

## Input errors

Mutations and queries reject clearly invalid input with a `ConvexError` whose data is
`{ code, message }`. Catch it and branch on `code`. Every error, with its fix, is in the README
[Errors and fixes](../README.md#errors-and-fixes) table.

| Code                  | Raised when                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `EMPTY_STRING`        | `scope`, `name`, `subjectRef`, `sessionRef`, `dedupeKey`, a dimension, or a config `key` is `""`. |
| `INVALID_TIMESTAMP`   | `ts`, or a range `from` / `to`, is `NaN` or infinite.                                             |
| `INVALID_SAMPLE_RATE` | `sampleRate` is not a number from 0 to 1.                                                         |
| `INVALID_PROP_VALUE`  | A prop is `NaN`, infinite, an object, or an array.                                                |
| `INVALID_PROP_KEY`    | A prop key is not printable ASCII, is over 1024 characters, or starts with `$` (HTTP).            |
| `INVALID_COUNT`       | `limit`, `periods`, or `numItems` is not a positive integer.                                      |
| `INVALID_CURSOR`      | A `list` cursor is not one returned by `list`.                                                    |
| `INVALID_BUCKETS`     | A `distribution` bucket bound is `NaN` or infinite.                                               |
| `INVALID_CONFIG`      | `retentionDays` or `sessionIdleMs` is not a positive finite number.                               |

Everything the component stores comes from the host: `props`, `subjectRef`, and so on are
stored as given, and the component never logs event data. Keep personal data (emails, IP
addresses, tokens in URLs) out of `props` and refs; hash or omit it before calling `track`.

> `funnel`, `retention`, and raw `list` are exposed through the client SDK and component
> functions, not the REST surface. The earlier web-locked routes (events/count/summary,
> funnel, retention, breakdown, attribution, lifecycle, stickiness, live, search, user,
> session, GDPR delete, alias, schemas, config) no longer exist.
