# REST API Reference

24 HTTP endpoints exposed via Convex `httpAction`. All require `x-api-key` header.

Base URL: `https://your-deployment.convex.site/api/analytics`

---

## Authentication

All endpoints require the `x-api-key` header. Keys are validated using timing-safe comparison against the `api_keys` config entry.

| Status | Meaning |
|--------|---------|
| 401 | Missing header, no keys configured, or invalid key |

---

## Endpoints

### POST /track

Ingest an event. Auto-derives geo from Vercel/Cloudflare headers, device/browser/OS from User-Agent.

**Body** (JSON):

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| userId | Yes | string | |
| sessionId | Yes | string | |
| name | Yes | string | Must match `/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/` |
| properties | No | object | Custom properties |
| projectId | No | string | Default: "default" |
| env | No | string | Default: "default" |
| platform | No | string | Default: "default" |
| timestamp | No | number | Epoch ms, default: now |
| path | No | string | |
| locale | No | string | |
| referrer | No | string | |
| device | No | string | Auto-derived from UA if omitted |
| browser | No | string | Auto-derived from UA if omitted |
| os | No | string | Auto-derived from UA if omitted |
| country | No | string | Auto-derived from X-Vercel-IP-Country / CF-IPCountry |
| region | No | string | Auto-derived from X-Vercel-IP-Country-Region |
| city | No | string | Auto-derived from X-Vercel-IP-City |
| utmSource | No | string | |
| utmMedium | No | string | |
| utmCampaign | No | string | |

**Response**: `201 { "ok": true }`

---

### GET /events

List events (paginated).

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| name | Yes | string | Event name |
| projectId | No | string | |
| env | No | string | |
| platform | No | string | |
| from | No | number | Epoch ms |
| to | No | number | Epoch ms |
| limit | No | number | Max 100 |
| cursor | No | string | Pagination cursor |

**Response**: `{ data: Event[], hasMore: boolean }`

---

### GET /count

Count events. Uses sharded counter for total count (O(shards)), daily_rollups for time-bounded.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| name | Yes | string | Event name |
| from | No | number | Epoch ms |
| to | No | number | Epoch ms |

**Response**: `{ name, count }`

---

### GET /summary

All event names with counts, sorted descending.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| projectId | No | string | |

**Response**: `[{ name, count }, ...]`

---

### GET /timeseries

Time-series data bucketed by interval.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| name | Yes | string | Event name |
| interval | No | string | day, week, or month (default: day) |
| projectId | No | string | |
| env | No | string | |
| from | No | number | Epoch ms |
| to | No | number | Epoch ms |

**Response**: `[{ date, count, uniques }, ...]`

---

### GET /funnel

Funnel conversion analysis. Scans up to 10,000 first-step events.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| steps | Yes | string | Comma-separated event names |
| window | No | string | Conversion window (default: "7d") |
| from | No | number | Epoch ms |
| to | No | number | Epoch ms |
| projectId | No | string | |

**Response**: `[{ step, count, rate, dropoff }, ...]`

---

### GET /retention

Cohort retention analysis.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| event | Yes | string | Event name |
| period | No | string | day, week, or month (default: week) |
| cohorts | No | number | Max 12 (default: 8) |
| projectId | No | string | |

**Response**: `{ cohorts: [{ period, date, size, retained: number[] }] }`

---

### GET /breakdown

Dimension breakdown for an event.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| name | Yes | string | Event name |
| dimension | Yes | string | One of: locale, country, device, browser, os, path, referrer, platform. Alias: `by` |
| from | No | number | Epoch ms |
| to | No | number | Epoch ms |
| projectId | No | string | |
| limit | No | number | Max 100 |

**Response**: `[{ value, count, percentage }, ...]`

---

### GET /attribution

Traffic source attribution for a conversion event.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| event | Yes | string | Conversion event name. Alias: `conversion_event` |
| from | No | number | Epoch ms |
| to | No | number | Epoch ms |
| projectId | No | string | |

**Response**: `[{ source, conversions, rate }, ...]`

---

### GET /uniques

DAU/WAU/MAU active user counts.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| period | No | string | day, week, or month (default: day) |
| from | No | number | Epoch ms |
| to | No | number | Epoch ms |
| projectId | No | string | |

**Response**: `{ dau, wau, mau, trend: [{ date, uniques }] }`

---

### GET /lifecycle

User lifecycle classification (new, returning, dormant, resurrected).

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| period | No | string | day, week, or month |
| from | No | number | Epoch ms |
| to | No | number | Epoch ms |
| projectId | No | string | |

**Response**: `{ new, returning, dormant, resurrected, total }`

---

### GET /stickiness

DAU/MAU engagement ratio.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| from | No | number | Epoch ms |
| to | No | number | Epoch ms |
| projectId | No | string | |

**Response**: `{ ratio, trend: [{ date, dau, mau, ratio }] }`

---

### GET /live

Real-time recent events.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| limit | No | number | Max 200 (default: 50) |
| projectId | No | string | |

**Response**: `Event[]`

---

### GET /search

Search event names by prefix.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| q | Yes | string | Search query |
| limit | No | number | Max 100 |

**Response**: `[{ name, count }, ...]`

---

### GET /user

User profile with event and session timeline.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| id | Yes | string | User/visitor ID |
| limit | No | number | Max 200 |

**Response**: `{ user, events, sessions }`

---

### GET /session

Session detail with ordered events.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| id | Yes | string | Session ID |

**Response**: `{ session, events }` (events sorted by seqNum)

---

### DELETE /user

GDPR deletion. Removes all events, sessions, and user record for the given ID.

| Param | Required | Type | Description |
|-------|----------|------|-------------|
| id | Yes | string | User/visitor ID |

**Response**: `{ ok: true, deleted: userId }`

---

### POST /alias

Merge anonymous user into identified user. Paginated reassignment (500/batch) of events and sessions, then user record merge.

**Body** (JSON):

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| anonymousId | Yes | string | Anonymous visitor ID |
| identifiedId | Yes | string | Identified user ID |

**Response**: `{ ok: true }`

---

### GET /schemas

List all event schemas.

**Response**: `[{ name, allowedProperties }, ...]`

---

### POST /schemas

Create or update an event schema.

**Body** (JSON):

| Field | Required | Type | Description |
|-------|----------|------|-------------|
| name | Yes | string | Event name |
| allowedProperties | Yes | object | `{ key: "string" | "number" | "boolean" }` |

**Response**: `{ ok: true }`

---

### GET /config

Get all config values. API keys are masked as `[N keys configured]`.

**Response**: `{ key: value, ... }`

---

### PATCH /config

Update mutable config values.

**Body** (JSON): Object of key-value pairs. Only mutable keys accepted: `retention_days`, `rate_limit`, `session_timeout`, `alert_threshold`.

**Response**: `{ ok: true }`

---

## Common Parameters

All GET endpoints support these scoping parameters:

| Param | Type | Description |
|-------|------|-------------|
| projectId | string | Filter by project |
| env | string | Filter by environment |
| platform | string | Filter by platform |
| from | number | Start of time range (epoch ms) |
| to | number | End of time range (epoch ms) |

## Error Format

All errors return JSON: `{ "error": "message" }` with appropriate HTTP status code (400, 401).
