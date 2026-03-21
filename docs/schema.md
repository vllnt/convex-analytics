# Database Schema

7 tables powering the analytics engine. Schema source of truth: `packages/convex-analytics/src/component/schema.ts`.

---

## events

Core event storage. Every tracked interaction is one row.

| Field | Type | Description |
|-------|------|-------------|
| userId | string | Visitor identifier |
| sessionId | string | Session identifier |
| name | string | Event name (regex: `/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/`) |
| projectId | string | Project scope (default: "default") |
| env | string | Environment scope (default: "default") |
| platform | string | Platform scope (default: "default") |
| properties | any | Custom event properties (filtered by event_schemas if registered) |
| timestamp | number | Epoch ms |
| path | string | Page/screen path |
| locale | string | User locale |
| referrer | string | Traffic source |
| device | string | Device type (desktop/mobile/tablet/bot) |
| browser | string | Browser name (Chrome/Firefox/Safari/Edge/Other) |
| os | string | Operating system |
| country | string | Country code (auto-derived from headers) |
| region | string? | Region (optional) |
| city | string? | City (optional) |
| utmSource | string? | UTM source |
| utmMedium | string? | UTM medium |
| utmCampaign | string? | UTM campaign |
| seqNum | number | Event sequence number within session (derived from session.eventCount) |

**Indexes** (12):

| Index | Fields | Purpose |
|-------|--------|---------|
| by_name_time | [name, timestamp] | Primary query path for most analytics |
| by_user_time | [userId, timestamp] | User timeline, alias reassignment |
| by_session | [sessionId, timestamp] | Session replay |
| by_name_path | [name, path, timestamp] | Path breakdown |
| by_name_locale | [name, locale, timestamp] | Locale breakdown |
| by_name_device | [name, device, timestamp] | Device breakdown |
| by_name_referrer | [name, referrer, timestamp] | Referrer breakdown |
| by_name_country | [name, country, timestamp] | Country breakdown |
| by_name_browser | [name, browser, timestamp] | Browser breakdown |
| by_name_os | [name, os, timestamp] | OS breakdown |
| by_project_name | [projectId, name, timestamp] | Multi-project queries |
| by_project_env | [projectId, env, timestamp] | Env-scoped queries |

---

## sessions

One row per session. Auto-created on first event for a sessionId. Closed by cron after 30min inactivity.

| Field | Type | Description |
|-------|------|-------------|
| userId | string | |
| sessionId | string | |
| projectId | string | |
| env | string | |
| platform | string | |
| startTime | number | First event timestamp |
| endTime | number? | Last activity timestamp (set by cron) |
| eventCount | number | Total events in session |
| entryPath | string | First page path |
| exitPath | string | Last page path |
| referrer | string | |
| device | string | |
| browser | string | |
| os | string | |
| locale | string | |
| country | string | |
| duration | number? | endTime - startTime (set by cron) |

**Indexes** (3):

| Index | Fields | Purpose |
|-------|--------|---------|
| by_user | [userId, startTime] | User's session history |
| by_time | [startTime] | Time-ordered session listing |
| by_session | [sessionId] | Direct session lookup |

---

## users

Aggregated user profile. Updated on each event. Stores latest device/browser/OS/locale/country.

| Field | Type | Description |
|-------|------|-------------|
| visitorId | string | Matches userId in events/sessions |
| projectIds | string[] | All projects this user has events in |
| firstSeen | number | Earliest event timestamp |
| lastSeen | number | Latest event timestamp |
| sessionCount | number | |
| totalEvents | number | |
| device | string | Latest device |
| browser | string | Latest browser |
| os | string | Latest OS |
| locale | string | Latest locale |
| country | string | Latest country |

**Indexes** (3):

| Index | Fields | Purpose |
|-------|--------|---------|
| by_visitor | [visitorId] | Direct user lookup |
| by_firstSeen | [firstSeen] | New user queries |
| by_lastSeen | [lastSeen] | Active/dormant user queries |

---

## daily_rollups

Pre-aggregated daily event counts with dimension breakdowns. Populated by cron every 5 minutes. Idempotent merge uses `Math.max` (safe to re-run).

| Field | Type | Description |
|-------|------|-------------|
| name | string | Event name |
| projectId | string | |
| env | string | |
| date | string | YYYY-MM-DD |
| count | number | Event count for this day |
| uniqueUsers | number | Unique users for this day |
| dimensions | any | Pre-aggregated breakdown: `{ locale: { "en": 5, "fr": 3 }, device: { "desktop": 6 }, ... }` |

**Indexes** (3):

| Index | Fields | Purpose |
|-------|--------|---------|
| by_name_date | [name, date] | Event-specific date range queries |
| by_project_date | [projectId, name, date] | Project-scoped rollup queries |
| by_date | [date] | Date-ordered listing, TTL cleanup |

---

## event_schemas

Property validation rules per event name. When a schema exists, `track()` silently drops unknown properties and type-mismatched values (intentional, not an error).

| Field | Type | Description |
|-------|------|-------------|
| name | string | Event name |
| allowedProperties | any | `{ key: "string" | "number" | "boolean" }` -- property validation rules |

**Indexes** (1):

| Index | Fields | Purpose |
|-------|--------|---------|
| by_name | [name] | Schema lookup during track() |

---

## config

Key-value configuration store. Values are JSON-encoded strings.

| Field | Type | Description |
|-------|------|-------------|
| key | string | Config key |
| value | string | JSON-encoded value |

**Known keys:**

| Key | Default | Mutable via API | Purpose |
|-----|---------|-----------------|---------|
| api_keys | -- | No | JSON array of API key strings |
| retention_days | 90 | Yes | Days before TTL cleanup |
| rate_limit | 100 | Yes | Events per minute per session |
| session_timeout | 30 | Yes | Minutes of inactivity before session close |
| alert_threshold | 8000 | Yes | Event count warning threshold |
| emergency_cleanup | "false" | No | Halves retention when storage >90% |

**Indexes** (1):

| Index | Fields | Purpose |
|-------|--------|---------|
| by_key | [key] | Direct config lookup |

---

## archives

References to archived event data in Convex file storage. Created by TTL cleanup cron.

| Field | Type | Description |
|-------|------|-------------|
| date | string | Archive date |
| fileId | Id<"_storage"> | Convex file storage reference |
| eventCount | number | Events in archive |
| sizeBytes | number | Archive file size |

**Indexes** (1):

| Index | Fields | Purpose |
|-------|--------|---------|
| by_date | [date] | Date-ordered archive lookup |
