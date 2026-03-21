---
title: convex-analytics — Full-Featured API-First Analytics Engine
status: active
created: 2026-03-19
estimate: 44h (5 phases)
tier: epic
---

# convex-analytics — Full-Featured API-First Analytics Engine

## Context

Open-source, multi-tenant Convex Component providing full product analytics — user identity, sessions, funnels, retention, time-series, breakdowns, attribution — accessible exclusively via authenticated REST API and MCP tools. No dashboard, no external services, no third-party data transfer. Built for AI-native workflows where Claude Code (or any MCP client) is the primary analytics interface.

Designed to be published on npm and listed on Convex's component registry. Any Convex app mounts it via `app.use()` and gets isolated, production-grade analytics with zero external dependencies.

### Why Not PostHog/GA4/Plausible?

| Concern | PostHog | GA4 | Plausible | This System |
|---------|---------|-----|-----------|-------------|
| Data ownership | Their servers (or self-host ClickHouse) | Google servers | Their servers | Your Convex deployment |
| Bundle size | 70-110KB | ~90KB | ~1KB | **0KB** (server-side) |
| Third-party transfer | Yes (unless self-hosted) | Yes | Yes | **No** |
| AI/MCP native | No | No | No | **Yes** |
| Reusable component | No | No | No | **Yes** (`app.use()`) |
| Convex-native | No | No | No | **Yes** |

Previous spec pivoted from PostHog after 8-perspective deep analysis surfaced: singleton lifecycle bugs, PII risk, GDPR data transfer, bundle bloat, MCP moat being ~50 LOC wrapper. This redesign addresses all gaps from that analysis — adds user identity, sessions, funnels, retention, time-series, breakdowns, attribution, lifecycle management, and AI-powered MCP queries.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  convex-analytics (Convex Component — npm package)                          │
│                                                                              │
│  WRITE PATH                                READ PATH                         │
│  ──────────                                ─────────                         │
│  track(event) ──▶ rate-limiter             REST API / MCP tools              │
│       │              │                         │                             │
│       ▼              ▼                         ▼                             │
│  ┌────────────────────────────┐   ┌──────────────────────────────────────┐  │
│  │ track() mutation            │   │ Query Engine (12 endpoints)          │  │
│  │                             │   │                                      │  │
│  │ 1. validate + sanitize      │   │ count · list · uniques · timeseries │  │
│  │ 2. db.insert("events")      │   │ funnel · retention · breakdown      │  │
│  │ 3. upsert session           │   │ attribution · user_timeline         │  │
│  │ 4. upsert user              │   │ session_detail · live · search      │  │
│  │ 5. aggregate.insert (sync)  │   │ compare (any endpoint)              │  │
│  │ 6. counter.inc              │   └──────────────────────────────────────┘  │
│  └────────────────────────────┘                                              │
│                                                                              │
│  ┌────────────┐ ┌──────────────┐ ┌────────────┐ ┌─────────────────────┐    │
│  │ events     │ │ sessions     │ │ users      │ │ daily_rollups       │    │
│  │            │ │              │ │            │ │                     │    │
│  │ userId     │ │ userId       │ │ visitorId  │ │ name + date         │    │
│  │ sessionId  │ │ startTime    │ │ firstSeen  │ │ count + uniques     │    │
│  │ name       │ │ endTime      │ │ lastSeen   │ │ dimensions (JSON)   │    │
│  │ properties │ │ eventCount   │ │ sessionCnt │ │ (locale, device,    │    │
│  │ timestamp  │ │ entryPath    │ │ totalEvts  │ │  country, browser,  │    │
│  │ path       │ │ exitPath     │ │ device     │ │  os, path, referrer)│    │
│  │ locale     │ │ referrer     │ │ locale     │ │                     │    │
│  │ referrer   │ │ device       │ │ country    │ │ indexes:            │    │
│  │ device     │ │ locale       │ │            │ │ by_name_date        │    │
│  │ country    │ │ country      │ │ indexes:   │ │                     │    │
│  │ browser    │ │ browser      │ │ by_first   │ │ Populated by        │    │
│  │ os         │ │ os           │ │ by_last    │ │ rollup cron (5min)  │    │
│  │ utm*       │ │ duration     │ │            │ │                     │    │
│  │ seqNum     │ │              │ │            │ └─────────────────────┘    │
│  │            │ │ indexes:     │ └────────────┘                            │
│  │ indexes:   │ │ by_user      │ ┌─────────────────────┐                   │
│  │ by_name_t  │ │ by_time      │ │ event_schemas       │                   │
│  │ by_user_t  │ └──────────────┘ │                     │                   │
│  │ by_session │                   │ name + allowed keys │                   │
│  │ by_name_p  │ ┌──────────────┐ │ + types             │                   │
│  │ by_name_l  │ │ config       │ │ (schema registry)   │                   │
│  │ by_name_c  │ │              │ │                     │                   │
│  │ (country)  │ │              │ │                     │                   │
│  └────────────┘ │              │ └─────────────────────┘                   │
│                 │ retention    │                                            │
│  CHILD COMPS:   │ rateLimit    │ ┌─────────────────────┐                   │
│  aggregate      │ origins      │ │ archives            │                   │
│  sharded-counter│ apiKeys[]    │ │ (Convex file refs)  │                   │
│  rate-limiter   └──────────────┘ │ JSONL exports       │                   │
│                                  └─────────────────────┘                   │
└──────────────────────────────────────────────────────────────────────────────┘

LIFECYCLE CRONS:
  rollup   (5min)  ──▶ aggregate new events → daily_rollups
  session  (5min)  ──▶ close sessions with 30min inactivity
  ttl      (daily) ──▶ archive + delete events older than retention period
  monitor  (weekly)──▶ log storage/quota usage, alert at 70%/90%
  rebalance(weekly)──▶ verify aggregate counts match actual

ACCESS:
  REST API ──▶ authenticated (API key header), paginated, 20 endpoints
  MCP      ──▶ 16 tools (12 structured + 4 AI-powered: NL query, anomaly, explain, funnel dropoff, lifecycle, paths)
```

### Data Lifecycle

```
event arrives ──▶ events table (hot — indexed, queryable)
                       │
                  5min ▼
              daily_rollups (warm — pre-aggregated, fast time-series)
                       │
              retention period (configurable, default 90d)  ▼
              archive to Convex Blob as JSONL (cold)
                       │
              delete from events table
                       │
              rollups + user/session tables kept indefinitely
```

### Performance Characteristics

| Operation | Complexity | Details |
|-----------|-----------|---------|
| `track()` write | O(log n) | Insert event + upsert session + upsert user + aggregate + counter |
| `count()` by name | O(log n) | Aggregate with namespace prefix |
| `timeseries()` | O(k) | k = number of date buckets, reads from daily_rollups |
| `list()` by name | O(k) | Index scan, k = page size |
| `funnel()` | O(u × s) | u = users in window, s = funnel steps (bounded by time range) |
| `retention()` | O(c × p) | c = cohort count, p = periods (reads from rollups + user table) |
| `breakdown()` | O(k) | Index scan on compound index (name + dimension) |
| `attribution()` | O(u) | u = converting users, group by referrer/UTM |
| `uniques()` | O(k) | From daily_rollups.uniqueUsers |
| `summary()` | O(m log n) | m = distinct event names |
| `live()` | O(k) | Last k events, index scan by _creationTime |

### Multi-Tenant Isolation

Each `app.use(analytics)` call creates a fully isolated instance:
- Separate tables (events, sessions, users, daily_rollups, event_schemas, config, archives — 7 tables per mount)
- Own aggregate tree + sharded counters
- Own rate limiter state
- Own config (retention, rate limits, API keys)
- Own cron schedules
- No cross-tenant data leakage — Convex Component sandboxing enforced

### Multi-Product / Multi-Env / Multi-Platform (Single Instance)

Within a single component mount, track multiple products, environments, and platforms via three scoping fields:

```
┌──────────────────────────────────────────────────────────┐
│  Single Convex deployment → app.use(analytics)           │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ projectId   │  │ env         │  │ platform    │     │
│  │             │  │             │  │             │     │
│  │ "myapp"     │  │ "production"│  │ "web"       │     │
│  │ "docs-site" │  │ "staging"   │  │ "ios"       │     │
│  │ "mobile-app"│  │ "dev"       │  │ "android"   │     │
│  │ "api"       │  │ "preview"   │  │ "api"       │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│                                                          │
│  Every query supports ?projectId=X&env=Y&platform=Z      │
│  Omit = query across all (global view)                   │
│  API keys can be scoped per projectId                    │
└──────────────────────────────────────────────────────────┘
```

- **projectId**: Logical product/app name (e.g. "myapp", "docs", "landing-page")
- **env**: Deployment environment (e.g. "production", "staging", "dev", "preview")
- **platform**: Client platform (e.g. "web", "ios", "android", "api", "cli")

All three are optional. Default: `"default"`. This means:
- Single-product users don't need to care — everything just works
- Multi-product users get filtering, breakdown, and cross-product queries from one instance
- No separate deployments needed per product/env

## Phased Delivery

```
PHASE 1: Core Engine         ████████████░░░░░░░░░░  ~12h
PHASE 2: Analytics Queries   ████████████░░░░░░░░░░  ~12h
PHASE 3: Lifecycle & Scale   ████████░░░░░░░░░░░░░░  ~8h
PHASE 4: MCP Intelligence    ████████░░░░░░░░░░░░░░  ~8h
PHASE 5: Open Source         ████░░░░░░░░░░░░░░░░░░  ~4h
                                            Total: ~44h

Dependencies:
  Phase 2 depends on Phase 1 (tables + write path)
  Phase 3 depends on Phase 1 (tables exist)
  Phase 4 depends on Phase 2 (query engine)
  Phase 5 depends on all (packaging)
  Phase 2 + Phase 3 can run in parallel after Phase 1
```

### Phase 1: Core Engine (~12h)

Data model, write path, basic reads, REST API, authentication, properties validation.

**Tables:**

```
events {
  // --- REQUIRED (caller must provide) ---
  userId:      string          // anonymous persistent visitor ID
  sessionId:   string          // session-scoped ID
  name:        string          // event name (e.g. "tutorial_start")

  // --- SCOPING (optional, default: "default") ---
  projectId:   string          // default: "default" — logical product/app ("myapp", "docs")
  env:         string          // default: "default" — environment ("production", "staging", "dev")
  platform:    string          // default: "default" — client platform ("web", "ios", "android", "api")

  // --- OPTIONAL (server defaults if omitted) ---
  properties:  object          // default: {} — validated against schema registry if registered
  timestamp:   number          // default: Date.now()
  path:        string          // default: "unknown"
  locale:      string          // default: "unknown"
  referrer:    string          // default: "" (direct)
  device:      string          // default: "unknown" — "desktop" | "mobile" | "tablet" | "bot"
  browser:     string          // default: "unknown" — "Chrome" | "Firefox" | "Safari" | "Edge" | "Other"
  os:          string          // default: "unknown" — "Windows" | "macOS" | "iOS" | "Android" | "Linux" | "Other"
  country:     string          // default: "unknown" — ISO 3166-1 alpha-2 (e.g. "US", "DE", "JP")
  region:      string?         // default: null — state/province (e.g. "CA", "Bayern")
  city:        string?         // default: null — city name (when available)
  utmSource:   string?         // default: null
  utmMedium:   string?         // default: null
  utmCampaign: string?         // default: null

  // --- AUTO-DERIVED (server-side, never passed) ---
  seqNum:      number          // monotonic per session (computed from session.eventCount)

  indexes:
    by_name_time:    [name, timestamp]
    by_user_time:    [userId, timestamp]
    by_session:      [sessionId, timestamp]
    by_name_path:    [name, path, timestamp]
    by_name_locale:  [name, locale, timestamp]
    by_name_device:  [name, device, timestamp]
    by_name_referrer:[name, referrer, timestamp]
    by_name_country: [name, country, timestamp]
    by_name_browser: [name, browser, timestamp]
    by_name_os:      [name, os, timestamp]
    by_project_name: [projectId, name, timestamp]
    by_project_env:  [projectId, env, timestamp]
}

NOTE — Geo derivation:
  REST POST /track (httpAction): Extract from request headers
    - Vercel: X-Vercel-IP-Country, X-Vercel-IP-Country-Region, X-Vercel-IP-City
    - Cloudflare: CF-IPCountry
    - Fallback: client passes geo in metadata arg
  Direct mutation: Client passes geo fields, or defaults to "unknown"
  Browser + OS: Parsed from User-Agent header (REST) or passed by client (mutation)

sessions {
  userId:      string
  sessionId:   string          // matches events.sessionId
  projectId:   string          // default: "default"
  env:         string          // default: "default"
  platform:    string          // default: "default"
  startTime:   number
  endTime:     number?         // null = active, set by session-closer cron
  eventCount:  number          // incremented per track()
  entryPath:   string          // first event's path
  exitPath:    string          // last event's path (updated per event)
  referrer:    string
  device:      string
  browser:     string
  os:          string
  locale:      string
  country:     string
  duration:    number?         // endTime - startTime (set on close)

  indexes:
    by_user:   [userId, startTime]
    by_time:   [startTime]
    by_session:[sessionId]
}

users {
  visitorId:    string         // = userId, the lookup key
  projectIds:   string[]       // all projects this user has been seen in
  firstSeen:    number
  lastSeen:     number         // updated per event
  sessionCount: number
  totalEvents:  number
  device:       string         // last known
  browser:      string         // last known
  os:           string         // last known
  locale:       string         // last known
  country:      string         // last known

  indexes:
    by_visitor:   [visitorId]
    by_firstSeen: [firstSeen]
    by_lastSeen:  [lastSeen]
}

daily_rollups {
  name:         string         // event name
  projectId:    string         // default: "default"
  env:          string         // default: "default"
  date:         string         // "YYYY-MM-DD"
  count:        number
  uniqueUsers:  number         // approximate (set of userId hashes)
  dimensions:   object         // pre-aggregated breakdowns per dimension:
                               // { locale:   { "en": 5, "fr": 2 },
                               //   device:   { "mobile": 3, "desktop": 7 },
                               //   country:  { "US": 4, "DE": 3 },
                               //   browser:  { "Chrome": 6, "Safari": 2 },
                               //   os:       { "macOS": 3, "Windows": 4 },
                               //   path:     { "/docs": 7, "/": 3 },
                               //   referrer: { "google.com": 4, "direct": 6 },
                               //   platform: { "web": 8, "ios": 2 } }

  indexes:
    by_name_date:    [name, date]
    by_project_date: [projectId, name, date]
    by_date:         [date]
}

event_schemas {
  name:              string    // event name
  allowedProperties: object    // { key: "string" | "number" | "boolean" }

  indexes:
    by_name: [name]
}

config {
  key:    string               // "retention_days" | "rate_limit" | "api_keys" | ...
  value:  string               // JSON-encoded value

  indexes:
    by_key: [key]
}

archives {
  date:       string           // "YYYY-MM-DD" — the date of archived events
  fileId:     Id<"_storage">   // Convex Blob file reference (JSONL)
  eventCount: number           // events in this archive file
  sizeBytes:  number           // file size for monitoring

  indexes:
    by_date: [date]
}
```

**Table count: 8** (events, sessions, users, daily_rollups, event_schemas, config, archives + Convex `_storage` for Blob files)

**Write path — `track()` mutation:**

```
track(userId, sessionId, name, properties?, metadata?) {

  REQUIRED:
    userId:      string          // anonymous persistent visitor ID
    sessionId:   string          // session-scoped ID
    name:        string          // event name

  SCOPING (optional, all default to "default"):
    projectId:   string          // default: "default" — logical product/app
    env:         string          // default: "default" — environment
    platform:    string          // default: "default" — client platform

  OPTIONAL (defaults applied server-side if omitted):
    properties:  object          // default: {}
    metadata.path:        string          // default: "unknown"
    metadata.locale:      string          // default: "unknown"
    metadata.referrer:    string          // default: "" (direct)
    metadata.device:      string          // default: "unknown"
    metadata.browser:     string          // default: "unknown"
    metadata.os:          string          // default: "unknown"
    metadata.country:     string          // default: "unknown"
    metadata.region:      string | null   // default: null
    metadata.city:        string | null   // default: null
    metadata.utmSource:   string | null   // default: null
    metadata.utmMedium:   string | null   // default: null
    metadata.utmCampaign: string | null   // default: null
    metadata.timestamp:   number          // default: Date.now()

  AUTO-DERIVED (server-side, never passed by client):
    seqNum:      number          // monotonic per session, computed from session.eventCount

  NOTE: REST POST /api/analytics/track auto-derives device, browser, os from
  User-Agent header and country/region/city from geo headers (X-Vercel-IP-Country,
  CF-IPCountry) — client only needs to send userId + sessionId + name.

  1. Rate limit check (per sessionId, configurable limit/min)
  2. Validate properties against event_schemas (if schema exists for this name)
  3. Sanitize: strip keys not in allowlist, reject PII patterns
  4. db.insert("events", { ...validated, seqNum: computed })
  5. Upsert session:
     - exists? → update eventCount++, exitPath, endTime
     - new?    → insert with entryPath, referrer, device, browser, os, country
  6. Upsert user:
     - exists? → update lastSeen, totalEvents++, sessionCount if new session,
                  device, browser, os, country (last known values)
     - new?    → insert with firstSeen = now, all metadata
  7. aggregate.insert(ctx, doc) with namespace "name:YYYY-MM-DD"
  8. shardedCounter.inc(ctx, name)
}

alias(anonymousId, identifiedId) {
  1. Find all events WHERE userId = anonymousId → update userId = identifiedId
  2. Find all sessions WHERE userId = anonymousId → update userId = identifiedId
  3. Merge user records:
     - Keep identifiedId user's visitorId
     - firstSeen = min(anonymous.firstSeen, identified.firstSeen)
     - totalEvents = sum of both
     - sessionCount = sum of both
     - lastSeen = max of both
  4. Delete anonymous user record
}
```

**REST API (authenticated):**

All endpoints require `x-api-key` header. Returns 401 without valid key.

| Method | Path | Phase | Description |
|--------|------|-------|-------------|
| POST | `/api/analytics/track` | 1 | Ingest event (alternative to mutation) |
| GET | `/api/analytics/events` | 1 | List events (paginated, filtered) |
| GET | `/api/analytics/count` | 1 | Count events by name + time range |
| GET | `/api/analytics/summary` | 1 | Aggregate counts per event name |
| GET | `/api/analytics/uniques` | 2 | DAU/WAU/MAU |
| GET | `/api/analytics/timeseries` | 2 | Events per interval (day/week/month) |
| GET | `/api/analytics/funnel` | 2 | Funnel conversion rates |
| GET | `/api/analytics/retention` | 2 | Cohort retention table |
| GET | `/api/analytics/breakdown` | 2 | Group by dimension (locale, path, device, browser, os, country, referrer, UTM) |
| GET | `/api/analytics/attribution` | 2 | Traffic source → conversion |
| GET | `/api/analytics/user/:id` | 2 | User event timeline |
| GET | `/api/analytics/session/:id` | 2 | Session event replay (ordered) |
| GET | `/api/analytics/live` | 2 | Last N events (real-time) |
| GET | `/api/analytics/search` | 2 | Event name prefix search |
| GET | `/api/analytics/lifecycle` | 2 | Classify users: new / returning / dormant / resurrected |
| GET | `/api/analytics/stickiness` | 2 | DAU/MAU ratio over time |
| POST | `/api/analytics/alias` | 1 | Merge anonymous userId into identified userId |
| GET | `/api/analytics/schemas` | 1 | List registered event schemas |
| POST | `/api/analytics/schemas` | 1 | Register/update event schema |
| GET | `/api/analytics/archives` | 3 | List archived date files with sizes |
| GET | `/api/analytics/archives/:date` | 3 | Download archive (signed URL to JSONL) |
| GET | `/api/analytics/config` | 1 | Read current config (retention, rate limit, etc.) |
| PATCH | `/api/analytics/config` | 1 | Update config values |
| DELETE | `/api/analytics/user/:id` | 3 | Delete all data for userId (GDPR Art 17) |
| DELETE | `/api/analytics/events` | 3 | Purge events by name + time range |

All GET endpoints support:
- `?compare=previous_period` for period-over-period comparison
- `?projectId=X` to scope to a specific product (omit = all projects)
- `?env=X` to scope to environment (omit = all envs)
- `?platform=X` to scope to platform (omit = all platforms)

**Client wrapper — `ConvexAnalytics` class:**

```typescript
interface ConvexAnalyticsConfig {
  retentionDays?: number       // default 90
  rateLimitPerMin?: number     // default 100
  apiKeys?: string[]           // for REST API auth
}

// --- Generic Type System (opt-in, not required) ---
//
// DEFAULT: no generic — fully permissive, any event name, any properties
//   const analytics = new ConvexAnalytics(component)
//   analytics.track("u1", "s1", "anything", { whatever: true })  // OK
//
// OPT-IN: consumer defines event catalog → compile-time safety
//   const analytics = new ConvexAnalytics<MyEvents>(component)
//   analytics.track("u1", "s1", "signup", { plan: "pro" })       // OK
//   analytics.track("u1", "s1", "typo_event", {})                // TYPE ERROR
//   analytics.track("u1", "s1", "signup", { plan: 123 })         // TYPE ERROR

// Consumer defines their event catalog as a type map:
type MyEvents = {
  signup:         { plan: "free" | "pro"; referral?: string }
  tutorial_start: { tutorialId: string; step: number }
  purchase:       { amount: number; currency: string; itemId: string }
  page_view:      {}  // no properties
}

// The default (untyped) event map — accepts any string key, any properties:
type DefaultEventMap = Record<string, Record<string, unknown>>

// Metadata type (shared, not generic — same for all events):
interface TrackMetadata {
  // Scoping (default: "default" for all)
  projectId?: string             // default: "default"
  env?: string                   // default: "default"
  platform?: string              // default: "default"
  // Event metadata
  timestamp?: number             // default: Date.now()
  path?: string                  // default: "unknown"
  locale?: string                // default: "unknown"
  referrer?: string              // default: ""
  device?: string                // default: "unknown"
  browser?: string               // default: "unknown"
  os?: string                    // default: "unknown"
  country?: string               // default: "unknown"
  region?: string | null         // default: null
  city?: string | null           // default: null
  utmSource?: string | null      // default: null
  utmMedium?: string | null      // default: null
  utmCampaign?: string | null    // default: null
}

// Dimension type — constrains breakdown/index dimensions:
type Dimension = "locale" | "path" | "device" | "browser" | "os"
              | "country" | "referrer" | "utmSource" | "utmMedium" | "utmCampaign"
              | "projectId" | "env" | "platform"

class ConvexAnalytics<TEvents extends Record<string, Record<string, unknown>> = DefaultEventMap> {
  // --- Write ---
  track<K extends keyof TEvents & string>(
    userId: string,
    sessionId: string,
    name: K,
    properties?: TEvents[K],
    metadata?: TrackMetadata
  ): Promise<void>

  identify(userId: string, traits?: Record<string, unknown>): Promise<void>

  alias(anonymousId: string, identifiedId: string): Promise<void>
  // Merges anonymous pre-auth user into identified post-auth user.
  // Updates all events + sessions from anonymousId → identifiedId.
  // Merges user records (keeps earliest firstSeen, sums totalEvents/sessionCount).
  // Required for funnels that cross the auth boundary (page_view → signup → onboard).

  debug(enabled: boolean): void
  // Enables console logging of every track() call for development.
  // Logs: event name, properties, metadata, userId, sessionId.
  // No-op in production (checks process.env.NODE_ENV).

  // --- Read (event name autocompletes from TEvents) ---
  summary(opts?): Promise<SummaryResult>
  count(name: keyof TEvents & string, opts?): Promise<number>
  list(name: keyof TEvents & string, opts?): Promise<PaginatedResult>
  timeseries(name: keyof TEvents & string, interval: "day" | "week" | "month", opts?): Promise<TimeseriesResult>
  funnel(steps: (keyof TEvents & string)[], opts?): Promise<FunnelResult>
  retention(event: keyof TEvents & string, opts?): Promise<RetentionResult>
  breakdown(name: keyof TEvents & string, dimension: Dimension, opts?): Promise<BreakdownResult>
  attribution(conversionEvent: keyof TEvents & string, opts?): Promise<AttributionResult>
  uniques(period: "day" | "week" | "month", opts?): Promise<UniquesResult>
  userTimeline(userId: string, opts?): Promise<UserTimelineResult>
  sessionDetail(sessionId: string): Promise<SessionDetailResult>
  lifecycle(period: "day" | "week" | "month", opts?): Promise<LifecycleResult>
  stickiness(opts?): Promise<StickinessResult>
  live(limit?: number): Promise<LiveResult>
  search(query: string, limit?: number): Promise<SearchResult>
}

// Usage examples:
//
// Untyped (default — zero friction, works immediately):
//   const analytics = new ConvexAnalytics(component)
//   analytics.track("u1", "s1", "any_event", { any_prop: true })
//
// Typed (opt-in — full autocomplete + compile-time validation):
//   const analytics = new ConvexAnalytics<MyEvents>(component)
//   analytics.track("u1", "s1", "signup", { plan: "pro" })           // ✓
//   analytics.track("u1", "s1", "signup", { plan: "invalid" })       // ✗ type error
//   analytics.track("u1", "s1", "nonexistent", {})                   // ✗ type error
//   analytics.funnel(["page_view", "signup", "purchase"])             // ✓ autocomplete
//   analytics.funnel(["page_view", "typo"])                           // ✗ type error
//   analytics.breakdown("signup", "country")                          // ✓ dimension typed
```

### Phase 2: Analytics Queries (~12h)

Full query engine — the features that make this a real analytics system.

| Query | Input | Output | Implementation |
|-------|-------|--------|----------------|
| **timeseries** | name, interval (day/week/month), from, to | `[{ date, count, uniques }]` | Read daily_rollups by name+date range, bucket by interval |
| **funnel** | steps[] (event names), window (e.g. "7d"), from, to | `[{ step, count, rate, dropoff }]` | For each user in window: check ordered event chain A→B→C with time constraint |
| **retention** | event, period (day/week/month), cohorts (count) | `{ cohorts: [{ period, date, size, retained[] }] }` | Group users by firstSeen bucket, check return in subsequent periods |
| **breakdown** | name, dimension (locale/path/device/browser/os/country/referrer/utm), from, to | `[{ value, count, percentage }]` | Index scan on compound index (name + dimension), group + count |
| **attribution** | conversion_event, from, to | `[{ source, medium, campaign, conversions, rate }]` | Find users who fired conversion event, group by referrer/UTM from first session |
| **user timeline** | userId, limit, cursor | `{ events[], sessions[], user }` | Index scan by userId, paginated |
| **session detail** | sessionId | `{ session, events[] }` | All events for session, ordered by seqNum |
| **live stream** | limit (default 50) | `[{ event }]` | Last N events by _creationTime |
| **uniques** | period (day/week/month), from, to | `{ dau, wau, mau, trend[] }` | From daily_rollups.uniqueUsers |
| **search** | query (prefix), limit | `[{ name, count }]` | Event name prefix match from aggregate |
| **lifecycle** | period (day/week/month), from, to | `{ new, returning, dormant, resurrected, counts[] }` | Classify users by firstSeen vs lastSeen: new (first seen in period), returning (seen before + in period), dormant (seen before, not in period), resurrected (dormant > 2 periods, returned) |
| **stickiness** | from, to | `{ ratio, trend: [{ date, dau, mau, ratio }] }` | DAU/MAU ratio from daily_rollups.uniqueUsers — measures engagement depth |
| **compare** | any endpoint + `compare=previous_period` | `{ current, previous, change_pct }` | Run same query for both periods, compute delta |

### Phase 3: Lifecycle & Scale (~8h)

Auto-cleanup, archiving, monitoring, GDPR compliance.

| Cron | Schedule | Function |
|------|----------|----------|
| **rollup** | Every 5 min | Aggregate new events since last run → upsert daily_rollups |
| **session_closer** | Every 5 min | Close sessions with no events in 30min (set endTime, duration) |
| **ttl_cleanup** | Daily | Archive events older than retention period → Convex Blob (JSONL), then delete |
| **monitor** | Weekly | Compute storage used, function calls used, alert at 70%/90% thresholds |
| **rebalance** | Weekly | Verify aggregate counts match actual table counts, log drift |

| Feature | Detail |
|---------|--------|
| **GDPR deletion** | `DELETE /api/analytics/user/:id` → deletes all events, sessions, user record for userId |
| **Data retention** | Configurable per mount (default 90d). Raw events archived then deleted. Rollups kept indefinitely. |
| **Archive format** | JSONL files in Convex Blob storage, partitioned by date. Downloadable via API. |
| **Properties allowlist** | Schema registry table enforces typed properties per event name. Unknown keys silently dropped. |
| **Storage monitoring** | Weekly cron logs current usage. Webhook/log alert at configurable thresholds. |
| **Counter rebalance** | Weekly verification that aggregate tree counts match `db.query("events").withIndex(...).collect().length` for a sample of event names. Logs drift. |

### Phase 4: MCP Intelligence (~8h)

AI-native query layer — the differentiator.

**MCP Server package: `convex-analytics-mcp`**

Standalone MCP server that connects to any Convex deployment running `convex-analytics`.

| Tool | Params | Description |
|------|--------|-------------|
| `query_analytics` | `{ question }` | NL → selects best structured query → executes → formats result with context |
| `get_timeseries` | `{ name, interval, from?, to? }` | Time-series data for an event |
| `get_funnel` | `{ steps[], window? }` | Funnel analysis with conversion rates per step |
| `get_retention` | `{ event, period?, cohorts? }` | Cohort retention table |
| `get_breakdown` | `{ name, dimension }` | Property/dimension breakdown |
| `get_attribution` | `{ conversion_event }` | Traffic source → conversion analysis |
| `get_user_journey` | `{ userId }` | Full user event + session timeline |
| `get_session` | `{ sessionId }` | Session event replay |
| `get_live` | `{ limit? }` | Real-time event stream |
| `compare_periods` | `{ name, period?, vs? }` | Period-over-period comparison |
| `detect_anomalies` | `{ name?, threshold? }` | Statistical deviation detection on rollup data |
| `explain_metric` | `{ metric, context? }` | LLM-powered: queries dimensions, synthesizes why a metric changed |
| `explain_funnel_dropoff` | `{ steps[], window? }` | LLM-powered: runs funnel + breakdowns at dropoff step, explains why users drop |
| `detect_lifecycle_stage` | `{ period? }` | Classifies user base health: new/returning/dormant/resurrected + trends |
| `analyze_paths` | `{ start_event, end_event?, limit? }` | Finds common event sequences users take after start_event |
| `get_stickiness` | `{ from?, to? }` | DAU/MAU ratio with trend |

**AI-in-the-processing-layer tools (the moat):**
- `query_analytics`: Parses NL question → selects correct structured endpoint → formats with analytical context. Not just a data dump.
- `detect_anomalies`: Z-score deviation on daily_rollups time-series. Flags spikes/drops exceeding threshold.
- `explain_metric`: Queries timeseries + breakdowns across multiple dimensions, uses LLM to synthesize a causal explanation.
- `explain_funnel_dropoff`: Runs funnel query, identifies biggest dropoff step, queries breakdowns (device, country, referrer) at that step, uses LLM to synthesize why users leave. Replaces PostHog's "correlation analysis" feature.
- `detect_lifecycle_stage`: Runs lifecycle query + timeseries on new/returning/dormant segments, synthesizes user base health. Replaces PostHog's "lifecycle analysis" feature.
- `analyze_paths`: Queries events by user after start_event, computes most common sequences, returns top N paths. Replaces PostHog's "paths" feature via data aggregation rather than custom UI.

### Phase 5: Open Source (~4h)

| Task | Detail |
|------|--------|
| npm package: `convex-analytics` | Component + client + types |
| npm package: `convex-analytics-mcp` | Standalone MCP server |
| README | Setup guide, API reference, MCP connection instructions |
| Demo project | Minimal Next.js + Convex app showing integration |
| Convex component registry | Submit for listing |
| License | MIT |
| CHANGELOG | Conventional commits → auto-generated |

## User Journeys

### Primary: App Developer Integration

ACTOR: Developer adding analytics to their Convex app
GOAL: Track events with full analytics capabilities, query via API/MCP
PRECONDITION: Convex app exists, `convex-analytics` installed

1. Developer installs package
   → `npm install convex-analytics`
   → Adds `app.use(analytics)` in `convex.config.ts`
   → Deploys — tables auto-created, crons auto-scheduled

2. Developer instruments events
   → `analytics.track(userId, sessionId, "signup", { plan: "pro" })`
   → Event persisted with all metadata (path, locale, referrer, device, UTM)
   → Session auto-created/updated, user auto-created/updated

3. Developer queries via REST API
   → `GET /api/analytics/timeseries?name=signup&interval=week` (API key in header)
   → Returns weekly signup counts with trend

4. Developer connects Claude Code via MCP
   → `claude mcp add convex-analytics-mcp --env CONVEX_URL=... --env API_KEY=...`
   → "How are signups trending this month?" → structured timeseries response
   → "What's the conversion funnel from page_view → signup → payment?" → funnel analysis

POSTCONDITION: Full analytics queryable via API and MCP, zero external services

### Secondary: MCP-First Analytics Workflow

ACTOR: Developer using Claude Code
GOAL: Understand product behavior via conversational analytics
PRECONDITION: MCP server connected, events flowing

1. "What happened yesterday?"
   → `query_analytics` → selects summary + timeseries for last 24h → formatted response

2. "Why did signups drop on Tuesday?"
   → `explain_metric` → queries timeseries + breakdowns by device, locale, referrer
   → Synthesizes: "Mobile signups dropped 40%. Correlates with referrer shift — Twitter campaign ended Monday."

3. "Show me the onboarding funnel"
   → `get_funnel` → steps: page_view → signup → onboard_step1 → onboard_complete
   → "Step 1→2 has 60% conversion, step 2→3 drops to 22%. Biggest drop-off."

4. "Are we retaining users week over week?"
   → `get_retention` → 8-week cohort table
   → "Week 1 retention is 35%, stabilizes at 12% by week 4."

POSTCONDITION: Developer has actionable product insights without opening any dashboard

### Error Journeys

E1. Convex unavailable / mutation fails
   → Bridge catches error silently (fire-and-forget)
   → Events lost during outage, app unaffected
   Recovery: Events lost, rollups unaffected (cron catches up)

E2. Consent declined (when consent integration used)
   → Client blocks track() calls, zero mutations
   Recovery: N/A — working as intended

E3. Rate limit exceeded (>configurable limit/min per session)
   → Rate limiter rejects silently, counter tracks rejected count
   → Normal users unaffected
   Recovery: Resumes after window

E4. Invalid API params
   → httpAction validates → 400 with structured error message
   Recovery: Consumer fixes request

E5. API key missing/invalid
   → 401 Unauthorized with message
   Recovery: Consumer uses correct key

E6. userId not provided
   → 400 with message "userId required"
   Recovery: Client generates anonymous ID

E7. Storage quota approaching limit
   → Monitor cron fires webhook/log alert at 70%
   → TTL cron accelerates cleanup if >90%
   Recovery: Increase retention aggressiveness or upgrade Convex plan

E8. Aggregate drift detected
   → Rebalance cron logs warning with drift percentage
   → If drift >5%, triggers backfill for affected event names
   Recovery: Automatic if <5%, manual intervention if >5%

### Edge Cases

EC1. DNT enabled: If consent integration used, blocks at init — zero mutations
EC2. Consent revoked mid-session: No new events written after revocation
EC3. Large event table (1M+ rows): Rollups serve time-series, aggregate serves counts, raw table only for list/detail
EC4. Component mounted multiple times: Each instance fully isolated
EC5. Concurrent writes from many sessions: Sharded counter distributes, no OCC contention
EC6. Session spans midnight: Session stays open, events cross date boundary, rollups attribute to event's date
EC7. User returns after 90 days (past retention): User record persists (never TTL'd), raw events archived, rollups still available
EC8. Funnel with >1000 users in window: Bounded by time range + pagination, no full scan
EC9. No events for a day: daily_rollup row not created (sparse), timeseries returns 0 for that date
EC10. Properties schema not registered: Event accepted with all properties (permissive mode), logged as unvalidated
EC11. Archive file download: Authenticated endpoint returns signed URL to Convex Blob file

## Acceptance Criteria

### Phase 1 — Core Engine (BLOCKING)

- [ ] AC-1: GIVEN track() called WHEN only userId + sessionId + name provided (no metadata) THEN event row created with all optional fields defaulted ("unknown", null, Date.now(), seqNum computed)
- [ ] AC-2: GIVEN track() called WHEN new userId THEN user record created with firstSeen = now
- [ ] AC-3: GIVEN track() called WHEN existing userId THEN user.lastSeen + user.totalEvents updated
- [ ] AC-4: GIVEN track() called WHEN new sessionId THEN session record created with entryPath + referrer
- [ ] AC-5: GIVEN track() called WHEN existing sessionId THEN session.eventCount++ and session.exitPath updated
- [ ] AC-6: GIVEN track() called THEN aggregate.insert with namespace "name:YYYY-MM-DD" and counter.inc
- [ ] AC-7: GIVEN component mounted via app.use() THEN isolated tables created, no cross-tenant leakage
- [ ] AC-8: GIVEN events exist WHEN GET /api/analytics/events?name=X called with valid API key THEN paginated JSON returned
- [ ] AC-9: GIVEN no API key header WHEN any GET endpoint called THEN 401 returned
- [ ] AC-10: GIVEN events exist WHEN GET /api/analytics/summary called THEN O(log n) counts per event name
- [ ] AC-11: GIVEN >configurable limit events/min from one session THEN excess silently dropped
- [ ] AC-12: GIVEN event_schema registered for "signup" WHEN track("signup", { unknown_key: 1 }) THEN unknown_key stripped, event saved with valid keys only
- [ ] AC-13: GIVEN events with seqNum WHEN session queried THEN events returned in seqNum order
- [ ] AC-14: GIVEN track() called with UTM params THEN utmSource, utmMedium, utmCampaign stored
- [ ] AC-14b: GIVEN track() called with geo metadata THEN country, region, city stored on event
- [ ] AC-14c: GIVEN track() called with browser/os metadata THEN browser + os stored on event, session, and user
- [ ] AC-14d: GIVEN POST /api/analytics/track via REST THEN geo derived from request headers (X-Vercel-IP-Country etc.), browser/os parsed from User-Agent
- [ ] AC-14e: GIVEN identify(userId, traits) called THEN user record updated with provided traits
- [ ] AC-14f: GIVEN ConvexAnalytics instantiated without generic THEN any event name + any properties accepted (permissive)
- [ ] AC-14g: GIVEN ConvexAnalytics<MyEvents> instantiated with generic THEN only defined event names compile, properties type-checked per event
- [ ] AC-15a: GIVEN anonymous user with events WHEN alias(anonymousId, identifiedId) called THEN all events + sessions reassigned to identifiedId, user records merged (earliest firstSeen, summed counts), anonymous user deleted
- [ ] AC-15d: GIVEN track() called with projectId="docs" + env="staging" + platform="web" THEN event stored with those scoping fields
- [ ] AC-15e: GIVEN events from multiple projectIds WHEN GET /events?projectId=docs called THEN only "docs" events returned
- [ ] AC-15f: GIVEN events from multiple envs WHEN timeseries?env=production called THEN only production rollups returned
- [ ] AC-15g: GIVEN events from all projects WHEN summary called without projectId THEN global summary across all projects returned
- [ ] AC-15b: GIVEN debug(true) called THEN every subsequent track() logs event details to console (name, properties, metadata, userId, sessionId)
- [ ] AC-15c: GIVEN debug(false) or production env THEN no console output from track()

### Phase 2 — Analytics Queries (BLOCKING)

- [ ] AC-15: GIVEN events over 30 days WHEN timeseries(name, "day") called THEN array of { date, count, uniques } returned, one per day
- [ ] AC-16: GIVEN users who fired A then B then C WHEN funnel([A,B,C], "7d") called THEN conversion rates per step returned
- [ ] AC-17: GIVEN users grouped by firstSeen week WHEN retention("active", "week", 8) called THEN 8-cohort retention table returned
- [ ] AC-18: GIVEN events with locale field WHEN breakdown("signup", "locale") called THEN grouped counts with percentages — also works for: country, device, browser, os, path, referrer, utm
- [ ] AC-19: GIVEN users who fired "purchase" WHEN attribution("purchase") called THEN grouped by referrer/UTM with conversion counts
- [ ] AC-20: GIVEN userId WHEN user/:id called THEN paginated event timeline + session list + user record
- [ ] AC-21: GIVEN sessionId WHEN session/:id called THEN ordered events (by seqNum) + session metadata
- [ ] AC-22: GIVEN events exist WHEN live(50) called THEN last 50 events by _creationTime
- [ ] AC-23: GIVEN any endpoint WHEN ?compare=previous_period added THEN both current + previous period returned with change_pct
- [ ] AC-24: GIVEN events WHEN uniques("day") called THEN DAU/WAU/MAU computed from daily_rollups
- [ ] AC-25: GIVEN events WHEN search("tutorial") called THEN event names matching prefix with counts
- [ ] AC-25b: GIVEN users with varying firstSeen/lastSeen WHEN lifecycle("week") called THEN users classified as new/returning/dormant/resurrected with counts
- [ ] AC-25c: GIVEN daily_rollups with uniqueUsers WHEN stickiness() called THEN DAU/MAU ratio returned with trend over time

### Phase 3 — Lifecycle & Scale (BLOCKING)

- [ ] AC-26: GIVEN new events WHEN rollup cron fires (5min) THEN daily_rollups updated with counts + uniqueUsers
- [ ] AC-27: GIVEN session with no events for 30min WHEN session_closer cron fires THEN session.endTime + session.duration set
- [ ] AC-28: GIVEN events older than retention period WHEN ttl cron fires THEN events archived to Convex Blob + deleted from table
- [ ] AC-29: GIVEN storage at 70% of quota WHEN monitor cron fires THEN warning logged/webhook fired
- [ ] AC-30: GIVEN aggregate drift >1% WHEN rebalance cron fires THEN drift logged, backfill triggered if >5%
- [ ] AC-31: GIVEN userId WHEN DELETE /api/analytics/user/:id called THEN all events + sessions + user record deleted (GDPR)
- [ ] AC-32: GIVEN archived events WHEN archive download requested THEN signed URL to JSONL file returned

### Phase 4 — MCP Intelligence (BLOCKING)

- [ ] AC-33: GIVEN MCP connected WHEN "how are signups trending?" asked THEN query_analytics selects timeseries, returns formatted data
- [ ] AC-34: GIVEN daily_rollups WHEN detect_anomalies() called THEN Z-score deviations above threshold flagged
- [ ] AC-35: GIVEN metric change WHEN explain_metric() called THEN multiple dimensions queried + synthesis returned
- [ ] AC-35b: GIVEN funnel with dropoff WHEN explain_funnel_dropoff() called THEN identifies dropoff step + queries breakdowns + synthesizes explanation
- [ ] AC-35c: GIVEN users WHEN detect_lifecycle_stage() called THEN classifies user base + returns health trends
- [ ] AC-35d: GIVEN events WHEN analyze_paths(start_event) called THEN returns top N common event sequences after start
- [ ] AC-36: GIVEN all 16 MCP tools (12 structured + 4 AI-powered) WHEN called with valid params THEN correct data returned matching REST API equivalents

### Phase 5 — Open Source (BLOCKING)

- [ ] AC-37: GIVEN `npm install convex-analytics` WHEN app.use(analytics) + deploy THEN tables created, crons running, API accessible
- [ ] AC-38: GIVEN `convex-analytics-mcp` installed WHEN configured with CONVEX_URL + API_KEY THEN all MCP tools functional
- [ ] AC-39: GIVEN demo project WHEN deployed to Convex THEN events trackable + queryable end-to-end

### Error Criteria (BLOCKING)

- [ ] AC-E1: GIVEN Convex mutation fails THEN no error propagated to caller
- [ ] AC-E2: GIVEN rate limit hit THEN app continues, no user-visible error
- [ ] AC-E3: GIVEN invalid API params THEN 400 with structured error message
- [ ] AC-E4: GIVEN invalid API key THEN 401 Unauthorized
- [ ] AC-E5: GIVEN missing userId in track() THEN 400 with "userId required"
- [ ] AC-E6: GIVEN storage >90% WHEN ttl cron fires THEN retention period temporarily halved for aggressive cleanup

## Scope

### Phase 1 — Core Engine

- [ ] S-1. Component definition: `convex.config.ts` + child components → AC-7
- [ ] S-2. Schema: events, sessions, users, daily_rollups, event_schemas, config tables → AC-1 through AC-6
- [ ] S-3. `track()` mutation: validate → insert event → upsert session → upsert user → aggregate → counter → AC-1 through AC-6, AC-11, AC-12, AC-13, AC-14, AC-14b, AC-14c
- [ ] S-3b. `identify()` mutation: update user record with traits → AC-14e
- [ ] S-3c. Geo derivation in REST POST /track: parse headers + UA → AC-14d
- [ ] S-3d. `alias()` mutation: merge anonymous → identified user (events, sessions, user records) → AC-15a
- [ ] S-3f. Multi-product scoping: projectId + env + platform fields on events/sessions/rollups + query filtering → AC-15d, AC-15e, AC-15f, AC-15g
- [ ] S-3e. `debug()` mode: console logging for track() calls in development → AC-15b, AC-15c
- [ ] S-4. Client wrapper: `ConvexAnalytics<TEvents>` class with opt-in generics + typed methods → AC-7, AC-14f, AC-14g
- [ ] S-5. REST API: /track, /events, /count, /summary, /schemas, /config endpoints + API key auth → AC-8, AC-9, AC-10
- [ ] S-6. Properties validation: event_schemas table + sanitization in track() → AC-12
- [ ] S-7. Config table: retention_days, rate_limit, api_keys → AC-11

### Phase 2 — Analytics Queries

- [ ] S-8. Timeseries query → AC-15
- [ ] S-9. Funnel query → AC-16
- [ ] S-10. Retention query → AC-17
- [ ] S-11. Breakdown query → AC-18
- [ ] S-12. Attribution query → AC-19
- [ ] S-13. User timeline + session detail queries → AC-20, AC-21
- [ ] S-14. Live stream + search queries → AC-22, AC-25
- [ ] S-15. Uniques (DAU/WAU/MAU) query → AC-24
- [ ] S-16. Compare (previous_period) modifier on all endpoints → AC-23
- [ ] S-16b. Lifecycle query (new/returning/dormant/resurrected) → AC-25b
- [ ] S-16c. Stickiness query (DAU/MAU ratio) → AC-25c

### Phase 3 — Lifecycle & Scale

- [ ] S-17. Rollup cron (5min) → AC-26
- [ ] S-18. Session closer cron (5min) → AC-27
- [ ] S-19. TTL cleanup cron (daily) + archive to Blob + archives table → AC-28, AC-32
- [ ] S-20. Monitor cron (weekly) → AC-29
- [ ] S-21. Rebalance cron (weekly) → AC-30
- [ ] S-22. GDPR deletion endpoint → AC-31
- [ ] S-23. Emergency cleanup (storage >90%) → AC-E6

### Phase 4 — MCP Intelligence

- [ ] S-24. MCP server package: 16 tools (12 structured + 4 AI-powered) → AC-36
- [ ] S-25. NL query engine (query_analytics tool) → AC-33
- [ ] S-26. Anomaly detection (detect_anomalies tool) → AC-34
- [ ] S-27. Metric explanation (explain_metric tool) → AC-35
- [ ] S-27b. Funnel dropoff explanation (explain_funnel_dropoff tool) → AC-35b
- [ ] S-27c. Lifecycle detection (detect_lifecycle_stage tool) → AC-35c
- [ ] S-27d. Path analysis (analyze_paths tool) → AC-35d

### Phase 5 — Open Source

- [ ] S-28. npm packaging: convex-analytics + convex-analytics-mcp → AC-37, AC-38
- [ ] S-28b. Export test helper: `convex-analytics/test` with register() for consumer testing → AC-37
- [ ] S-29. README + API reference documentation → AC-37
- [ ] S-30. Demo project → AC-39
- [ ] S-31. Convex component registry submission → AC-37

## Quality Checklist

### Blocking

- [ ] All Phase ACs passing (AC-1 through AC-39 + AC-14b-g, AC-15a-c, AC-25b-c, AC-35b-d)
- [ ] All Error Criteria ACs passing (AC-E1 through AC-E6)
- [ ] 100% test coverage: every AC, error criterion, and edge case has a passing test
- [ ] All mutations have validators for args AND returns
- [ ] No `.collect()` on unbounded queries — use `.paginate()` or `.take(n)`
- [ ] All queries use `.withIndex()` — no `.filter()` on large tables
- [ ] REST API authenticated on every endpoint (API key)
- [ ] Properties validated against schema registry when schema exists
- [ ] GDPR deletion removes ALL data for userId (events + sessions + user)
- [ ] Aggregate synced atomically with event insert (same mutation)
- [ ] Component tables isolated from app tables (multi-tenant)
- [ ] Crons idempotent (safe to re-run, no duplicate rollups)
- [ ] No hardcoded credentials
- [ ] TTL cron archives before deleting (no data loss)

### Advisory

- [ ] Event seqNum monotonically increasing per session
- [ ] daily_rollups sparse (no rows for zero-event days)
- [ ] Session timeout configurable (default 30min)
- [ ] Rate limit configurable per mount
- [ ] Aggregate namespace: "name:YYYY-MM-DD" for time-bucketed counts
- [ ] Sharded counter: 16 shards per event name
- [ ] Archive JSONL partitioned by date
- [ ] Monitor cron thresholds configurable (default 70%/90%)

## Test Strategy

Runner: vitest | Component tests: convex-test | TDD: RED → GREEN per AC

**BLOCKING: 100% AC + error + edge case coverage. No phase complete without full pass.**

### Phase 1 Traceability Matrix

| AC | Test Type | Test File | Intention | Status |
|----|-----------|-----------|-----------|--------|
| AC-1 | unit (convex-test) | `track.test.ts` | track() creates event row with all metadata | [ ] |
| AC-2 | unit (convex-test) | `track.test.ts` | New userId → user record with firstSeen | [ ] |
| AC-3 | unit (convex-test) | `track.test.ts` | Existing userId → lastSeen + totalEvents updated | [ ] |
| AC-4 | unit (convex-test) | `track.test.ts` | New sessionId → session record created | [ ] |
| AC-5 | unit (convex-test) | `track.test.ts` | Existing sessionId → eventCount++ + exitPath updated | [ ] |
| AC-6 | unit (convex-test) | `track.test.ts` | Aggregate insert with "name:date" namespace + counter inc | [ ] |
| AC-7 | unit (convex-test) | `component.test.ts` | app.use() isolation — two instances, no cross-contamination | [ ] |
| AC-8 | unit (convex-test) | `api.test.ts` | GET /events?name=X → paginated JSON | [ ] |
| AC-9 | unit (convex-test) | `api.test.ts` | No API key → 401 | [ ] |
| AC-10 | unit (convex-test) | `api.test.ts` | GET /summary → O(log n) counts | [ ] |
| AC-11 | unit (convex-test) | `track.test.ts` | Exceed rate limit → silent drop | [ ] |
| AC-12 | unit (convex-test) | `track.test.ts` | Schema registered → unknown keys stripped | [ ] |
| AC-13 | unit (convex-test) | `track.test.ts` | Events have monotonic seqNum per session | [ ] |
| AC-14 | unit (convex-test) | `track.test.ts` | UTM params stored when provided | [ ] |
| AC-14b | unit (convex-test) | `track.test.ts` | Geo fields (country, region, city) stored on event | [ ] |
| AC-14c | unit (convex-test) | `track.test.ts` | Browser + OS stored on event, session, user | [ ] |
| AC-14d | unit (convex-test) | `api.test.ts` | REST POST /track derives geo from headers, parses UA | [ ] |
| AC-14e | unit (convex-test) | `track.test.ts` | identify() updates user traits | [ ] |
| AC-14f | type (tsd) | `client.test-d.ts` | Untyped instance accepts any event name + props | [ ] |
| AC-14g | type (tsd) | `client.test-d.ts` | Typed instance rejects unknown events + wrong props | [ ] |
| AC-15a | unit (convex-test) | `track.test.ts` | alias() merges anonymous → identified, reassigns events/sessions, merges user | [ ] |
| AC-15d | unit (convex-test) | `track.test.ts` | Scoping fields (projectId, env, platform) stored on event | [ ] |
| AC-15e | unit (convex-test) | `api.test.ts` | GET /events?projectId=X filters correctly | [ ] |
| AC-15f | unit (convex-test) | `queries.test.ts` | Timeseries scoped by env returns only matching rollups | [ ] |
| AC-15g | unit (convex-test) | `api.test.ts` | Summary without scoping returns global aggregates | [ ] |
| AC-15b | unit | `client.test.ts` | debug(true) → console.log per track() call | [ ] |
| AC-15c | unit | `client.test.ts` | debug(false) → no console output | [ ] |

### Phase 2 Traceability Matrix

| AC | Test Type | Test File | Intention | Status |
|----|-----------|-----------|-----------|--------|
| AC-15 | unit (convex-test) | `queries.test.ts` | Timeseries returns daily buckets with counts | [ ] |
| AC-16 | unit (convex-test) | `queries.test.ts` | Funnel: users who did A→B→C, conversion per step | [ ] |
| AC-17 | unit (convex-test) | `queries.test.ts` | Retention: cohort-by-week, return rates | [ ] |
| AC-18 | unit (convex-test) | `queries.test.ts` | Breakdown by locale returns grouped counts | [ ] |
| AC-19 | unit (convex-test) | `queries.test.ts` | Attribution: conversion grouped by referrer | [ ] |
| AC-20 | unit (convex-test) | `queries.test.ts` | User timeline returns events + sessions | [ ] |
| AC-21 | unit (convex-test) | `queries.test.ts` | Session detail returns ordered events | [ ] |
| AC-22 | unit (convex-test) | `queries.test.ts` | Live returns last N events | [ ] |
| AC-23 | unit (convex-test) | `queries.test.ts` | Compare returns current + previous + change_pct | [ ] |
| AC-24 | unit (convex-test) | `queries.test.ts` | Uniques returns DAU/WAU/MAU from rollups | [ ] |
| AC-25 | unit (convex-test) | `queries.test.ts` | Search returns matching event names | [ ] |
| AC-25b | unit (convex-test) | `queries.test.ts` | Lifecycle classifies users as new/returning/dormant/resurrected | [ ] |
| AC-25c | unit (convex-test) | `queries.test.ts` | Stickiness returns DAU/MAU ratio with trend | [ ] |

### Phase 3 Traceability Matrix

| AC | Test Type | Test File | Intention | Status |
|----|-----------|-----------|-----------|--------|
| AC-26 | unit (convex-test) | `crons.test.ts` | Rollup cron aggregates events into daily_rollups | [ ] |
| AC-27 | unit (convex-test) | `crons.test.ts` | Session closer sets endTime after 30min inactivity | [ ] |
| AC-28 | unit (convex-test) | `crons.test.ts` | TTL cron archives + deletes old events | [ ] |
| AC-29 | unit (convex-test) | `crons.test.ts` | Monitor cron logs warning at 70% storage | [ ] |
| AC-30 | unit (convex-test) | `crons.test.ts` | Rebalance cron detects + logs drift | [ ] |
| AC-31 | unit (convex-test) | `api.test.ts` | DELETE user/:id removes all user data | [ ] |
| AC-32 | unit (convex-test) | `api.test.ts` | Archive download returns signed URL | [ ] |

### Phase 4 Traceability Matrix

| AC | Test Type | Test File | Intention | Status |
|----|-----------|-----------|-----------|--------|
| AC-33 | unit | `mcp.test.ts` | NL query routes to correct structured query | [ ] |
| AC-34 | unit | `mcp.test.ts` | Anomaly detection flags Z-score deviations | [ ] |
| AC-35 | unit | `mcp.test.ts` | Explain metric queries multiple dimensions + synthesizes | [ ] |
| AC-35b | unit | `mcp.test.ts` | Funnel dropoff explanation queries breakdowns + synthesizes | [ ] |
| AC-35c | unit | `mcp.test.ts` | Lifecycle detection classifies user base health | [ ] |
| AC-35d | unit | `mcp.test.ts` | Path analysis returns common event sequences | [ ] |
| AC-36 | unit | `mcp.test.ts` | All 16 tools return correct data | [ ] |

### Phase 5 Traceability Matrix

| AC | Test Type | Test File | Intention | Status |
|----|-----------|-----------|-----------|--------|
| AC-37 | integration | `integration.test.ts` | npm install → app.use() → deploy → tables exist | [ ] |
| AC-38 | integration | `integration.test.ts` | MCP server connects + all tools work | [ ] |
| AC-39 | integration | `integration.test.ts` | Demo project tracks + queries end-to-end | [ ] |

### Error & Edge Case Tests (BLOCKING)

| ID | Test Type | Test File | Intention | Status |
|----|-----------|-----------|-----------|--------|
| AC-E1 | unit | `track.test.ts` | Mutation failure → no error propagated | [ ] |
| AC-E2 | unit | `track.test.ts` | Rate limit → silent drop, app continues | [ ] |
| AC-E3 | unit (convex-test) | `api.test.ts` | Invalid params → 400 structured error | [ ] |
| AC-E4 | unit (convex-test) | `api.test.ts` | Invalid API key → 401 | [ ] |
| AC-E5 | unit (convex-test) | `api.test.ts` | Missing userId → 400 | [ ] |
| AC-E6 | unit (convex-test) | `crons.test.ts` | Storage >90% → retention halved | [ ] |
| EC1 | unit | `track.test.ts` | DNT → zero mutations | [ ] |
| EC2 | unit | `track.test.ts` | Consent revoked → no writes | [ ] |
| EC3 | perf (convex-test) | `perf.test.ts` | 1000+ events → rollups serve timeseries, not table scan | [ ] |
| EC4 | unit (convex-test) | `component.test.ts` | Two mounts fully isolated | [ ] |
| EC5 | unit (convex-test) | `track.test.ts` | 10 concurrent tracks → no OCC errors | [ ] |
| EC6 | unit (convex-test) | `crons.test.ts` | Session spanning midnight → correct date rollup | [ ] |
| EC7 | unit (convex-test) | `crons.test.ts` | User returns after TTL → user record still exists | [ ] |
| EC8 | perf (convex-test) | `perf.test.ts` | Funnel with 500 users → completes <1s | [ ] |
| EC9 | unit (convex-test) | `queries.test.ts` | Zero-event day → timeseries returns 0, not missing | [ ] |
| EC10 | unit (convex-test) | `track.test.ts` | No schema registered → permissive, all props accepted | [ ] |
| EC11 | unit (convex-test) | `api.test.ts` | Archive download → signed URL returned | [ ] |

### Coverage Rules (BLOCKING)

- Every AC must have at least one test — no exceptions
- Every error criterion (AC-E1 through AC-E6) must have at least one test
- Every edge case (EC1 through EC11) must have at least one test
- Tests must fail before implementation (RED), pass after (GREEN) — TDD enforced
- No test may use `.collect()` on unbounded queries (mirrors production constraint)
- Perf tests (EC3, EC8) must assert timing, not just correctness
- Cron tests must verify idempotency (run cron handler twice → same result)
- Seed data via mutations (tests the write path), not via `t.run()` db inserts

### Test Infrastructure

Runner: **vitest** | Component harness: **convex-test** | TDD: RED → GREEN

#### Test Setup (MANDATORY pattern for all test files)

```typescript
// packages/convex-analytics/tests/test-helpers.ts
import { convexTest } from "convex-test";
import schema from "../src/component/schema";

const modules = import.meta.glob("../src/component/**/*.ts");

export function initConvexTest() {
  // Fresh instance per test — full isolation, no shared state
  const t = convexTest(schema, modules);
  // Child components (aggregate, sharded-counter, rate-limiter)
  // resolved automatically from modules glob
  return t;
}
```

#### Test Categories

| Category | Harness | Pattern | Files |
|----------|---------|---------|-------|
| **Component mutations/queries** | `convex-test` | `t.mutation()` / `t.query()` with component API | `track.test.ts`, `queries.test.ts` |
| **Direct DB verification** | `convex-test` | `t.run(async (ctx) => ctx.db.query(...))` | All — verify internal state |
| **HTTP API endpoints** | `convex-test` | `t.run()` invoking httpAction handlers directly | `api.test.ts` |
| **Cron handlers** | `convex-test` | `t.run()` calling `internal.crons.*` directly | `crons.test.ts` |
| **Multi-tenant isolation** | `convex-test` | Two separate `initConvexTest()` instances | `component.test.ts` |
| **MCP tools** | vitest | Call MCP tool handler functions directly | `mcp.test.ts` |
| **Performance** | `convex-test` | Seed N events via mutations, assert timing | `perf.test.ts` |
| **Type safety (generics)** | `tsd` | Compile-time assertions on `ConvexAnalytics<T>` | `client.test-d.ts` |
| **Client wrapper** | vitest | Unit test debug mode, alias, identify | `client.test.ts` |
| **Integration (Phase 5)** | vitest + real deploy | `npm install` → `app.use()` → deploy → track → query | `integration.test.ts` |

#### Convex Component Testing Rules (BLOCKING)

| Rule | Why | Anti-Pattern |
|------|-----|-------------|
| **Fresh `convexTest()` per test** | Full isolation — no shared state between tests | Reusing `t` across tests |
| **Seed data via `t.mutation()`** | Tests the actual write path, not just DB state | `t.run((ctx) => ctx.db.insert(...))` for seeding |
| **Use `t.run()` only for assertions** | Verify internal state that queries don't expose | Using `t.run()` to set up test data |
| **Test crons via `internal.*` calls** | Invoke cron handlers directly, don't wait for scheduler | Relying on cron scheduler timing |
| **Test idempotency: run handler twice** | Crons must be safe to re-run (no duplicate rollups) | Testing cron once and assuming idempotent |
| **Verify defaults explicitly** | Assert that omitted fields get correct defaults | Assuming defaults without checking |
| **Test child component interactions** | Verify aggregate + counter updated atomically | Skipping aggregate/counter verification |
| **No mocking of Convex internals** | `convex-test` IS the mock — test against it | Mocking `ctx.db` manually |

#### Open-Source Test Helper Export (Phase 5 — BLOCKING)

The `convex-analytics` package MUST export a test registration helper so consumers can test their integration:

```typescript
// packages/convex-analytics/src/test.ts — exported from package
import schema from "./component/schema";

const modules = import.meta.glob("./component/**/*.ts");

export default {
  register(t: ConvexTest) {
    // Registers component tables, child components, modules
    // So consumers can test their integration with convex-analytics
  },
  schema,
  modules,
};
```

Consumer usage:

```typescript
// In consumer's test file
import analyticsTest from "convex-analytics/test";
import { convexTest } from "convex-test";
import { components } from "./_generated/api";

function initTest() {
  const t = convexTest();
  analyticsTest.register(t);
  return t;
}

test("my app tracks events correctly", async () => {
  const t = initTest();
  // Test consumer-side integration with the component
  await t.run(async (ctx) => {
    await myAppTrackFunction(ctx, components.analytics, {
      userId: "u1", sessionId: "s1", name: "signup",
    });
  });
});
```

#### Example Test Patterns (Reference)

**Pattern: Mutation + DB verification**
```typescript
test("track() creates event + session + user atomically", async () => {
  const t = initConvexTest();

  await t.mutation(api.events.track, {
    userId: "u1", sessionId: "s1", name: "signup",
  });

  // Verify event
  const events = await t.query(api.events.list, { name: "signup" });
  expect(events.data).toHaveLength(1);
  expect(events.data[0].country).toBe("unknown"); // default applied

  // Verify session created (direct DB — internal state)
  await t.run(async (ctx) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session", (q) => q.eq("sessionId", "s1"))
      .unique();
    expect(session).not.toBeNull();
    expect(session!.eventCount).toBe(1);
    expect(session!.entryPath).toBe("unknown");
  });

  // Verify user created
  await t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_visitor", (q) => q.eq("visitorId", "u1"))
      .unique();
    expect(user!.totalEvents).toBe(1);
    expect(user!.sessionCount).toBe(1);
  });
});
```

**Pattern: Cron idempotency**
```typescript
test("rollup cron is idempotent", async () => {
  const t = initConvexTest();

  await t.mutation(api.events.track, {
    userId: "u1", sessionId: "s1", name: "signup",
  });

  // Run cron twice
  await t.run(async (ctx) => {
    await ctx.runMutation(internal.crons.rollup);
    await ctx.runMutation(internal.crons.rollup);
  });

  // Verify count is 1, not 2
  await t.run(async (ctx) => {
    const rollup = await ctx.db
      .query("daily_rollups")
      .withIndex("by_name_date", (q) => q.eq("name", "signup"))
      .unique();
    expect(rollup!.count).toBe(1);
  });
});
```

**Pattern: Multi-tenant isolation**
```typescript
test("two component instances are fully isolated", async () => {
  const t1 = initConvexTest();
  const t2 = initConvexTest();

  await t1.mutation(api.events.track, {
    userId: "u1", sessionId: "s1", name: "signup",
  });

  const events = await t2.query(api.events.list, { name: "signup" });
  expect(events.data).toHaveLength(0); // t2 sees nothing
});
```

**Pattern: Scoping filter**
```typescript
test("projectId filter scopes queries correctly", async () => {
  const t = initConvexTest();

  await t.mutation(api.events.track, {
    userId: "u1", sessionId: "s1", name: "signup",
    projectId: "docs", env: "production", platform: "web",
  });
  await t.mutation(api.events.track, {
    userId: "u2", sessionId: "s2", name: "signup",
    projectId: "app", env: "production", platform: "ios",
  });

  // Scoped query
  const docsEvents = await t.query(api.events.list, {
    name: "signup", projectId: "docs",
  });
  expect(docsEvents.data).toHaveLength(1);
  expect(docsEvents.data[0].projectId).toBe("docs");

  // Unscoped = all
  const allEvents = await t.query(api.events.list, { name: "signup" });
  expect(allEvents.data).toHaveLength(2);
});
```

## Risks

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Funnel query O(u×s) too slow at scale | Timeouts on large datasets | MED | Bound by time range, paginate users, add funnel materialization if needed |
| Convex free tier storage (16MB) exhausted quickly | Events stop persisting | HIGH | TTL cron mandatory from Phase 1, default 90d retention |
| 3x function calls per track() (mutation+aggregate+counter) | Free tier = ~333k events/month not 1M | HIGH | Document clearly, optimize to batch aggregate/counter in same call |
| Aggregate drift after partial mutation failure | Counts wrong | LOW | Convex mutation atomicity prevents this + weekly rebalance cron |
| @convex-dev/* packages abandoned or breaking | Build failures | LOW | Pin versions, fork if needed |
| Convex ships native analytics | This project made redundant | MED | Open source + community = survival independent of Convex |
| Properties schema rot (untyped JSON) | Data quality degrades | MED | Schema registry + validation at write boundary |
| Convex pricing changes | Cost model breaks | MED | TTL + archiving keeps storage bounded, document cost model |
| MCP ecosystem fragments (not just Anthropic) | AI-native value reduced | LOW | REST API is primary interface, MCP is additive |

**Kill criteria:**
1. If Convex Component child-component nesting doesn't work → fall back to flat component with manual denormalization
2. If funnel queries >5s at 10k users → add materialized funnel steps table
3. If Convex adds native analytics with MCP → pivot to wrapper/adapter role

## State Machine

### Session Lifecycle

```
┌─────────┐   first event    ┌─────────┐   no events     ┌─────────┐
│  NONE   │────────────────▶│  ACTIVE  │───(30min)──────▶│ CLOSED  │
└─────────┘                  └────┬─────┘                 └─────────┘
                                  │  ▲
                                  │  │
                              new event
                              (resets timer)
```

- **NONE → ACTIVE**: First `track()` for a sessionId creates the session record
- **ACTIVE → ACTIVE**: Each subsequent `track()` updates exitPath, eventCount, resets inactivity timer
- **ACTIVE → CLOSED**: Session-closer cron detects 30min inactivity, sets endTime + duration

**Complexity: LOW** (3 states, 3 transitions, 0 guards) — `useState` acceptable.

### Event Lifecycle

```
┌──────┐   track()    ┌──────┐   rollup cron   ┌──────────┐   TTL cron    ┌──────────┐
│ NONE │─────────────▶│ HOT  │────────────────▶│ ROLLED UP│──────────────▶│ ARCHIVED │
└──────┘              └──────┘                 └──────────┘               └────┬─────┘
                                                                               │
                                                                          delete from
                                                                          events table
```

**Complexity: LOW** (4 states, 3 transitions, 0 guards)

## Analysis

**Assumptions:**
- Convex child components work inside custom components → VALID (documented)
- O(log n) aggregate reads at scale → VALID (battle-tested)
- Funnel queries feasible on document store → NEEDS VALIDATION (Phase 2 spike)
- Convex Blob suitable for archive storage → VALID (documented for file storage)
- MCP protocol stable enough to build on → VALID (Anthropic pushing adoption)

**Blind Spots:**
- [Funnel cost] Funnel queries iterate users × steps. May need materialized funnel table at >50k users.
- [Retention cost] Retention cohorts require user-scoped time queries. Efficient with by_user_time index but still O(cohort_size × periods).
- [uniqueUsers approximation] daily_rollups.uniqueUsers requires deduplication. Exact unique counts need set membership tracking. Consider HyperLogLog approximation for scale.
- [MCP NL quality] `query_analytics` NL routing depends on LLM classification quality. May misroute ambiguous queries.

**Failure Hypotheses:**
| IF | THEN | BECAUSE | Severity | Mitigation |
|----|------|---------|----------|------------|
| Funnel query >5s at 10k users | Feature unusable | O(u×s) on document store | MED | Materialize funnel steps, add time-range bounds |
| daily_rollups uniqueUsers wrong | DAU/MAU metrics unreliable | Approximate dedup | MED | Use exact count for <10k users, HLL for >10k |
| TTL cron fails silently | Storage explodes | Fire-and-forget cron errors | HIGH | Monitor cron health, alert on skip |
| NL query misroutes | Wrong data returned | Ambiguous question | LOW | Fall back to structured tools, log misroutes |
| Multiple track() calls race on session upsert | Session state inconsistent | OCC contention on session doc | MED | Use sharded approach or accept last-write-wins |

## Structural Gaps (Permanent — Out of Scope)

Features that cannot be added without fundamental architecture changes. Documented for transparency.

| Gap | Why Structural | PostHog Has It? | Mitigation |
|-----|---------------|-----------------|------------|
| **Session replay** | Requires DOM snapshots, network recording, massive storage. Separate product. | YES | Out of scope permanently. Use PostHog session replay alongside if needed. |
| **Heatmaps** | Requires client-side DOM coordinate tracking + rendering engine. | YES | Out of scope permanently. |
| **Ad-hoc property queries** | Convex = document store. Properties are JSON blob, not columnar. Can't filter by arbitrary property without full scan. | YES (ClickHouse columnar) | Schema registry + indexed dimensions cover 90% of use cases. True ad-hoc requires columnar engine. |
| **SQL query engine** | No HogQL equivalent on Convex. Queries are pre-defined functions. | YES (HogQL) | 16 MCP tools + NL query cover most analytical questions. Power users limited to defined endpoints. |
| **Feature flags** | Separate concern, many standalone options exist. | YES (bundled) | Use Vercel Flags, LaunchDarkly, or similar. Not an analytics feature. |
| **Surveys** | Requires UI rendering, response collection, analysis. Separate product. | YES | Out of scope. Use Typeform, Formbricks, etc. |

**Design decision**: These gaps are intentional. convex-analytics competes on *access model* (API-first, AI-native) not on *feature count*. LLM-powered MCP tools (`explain_funnel_dropoff`, `detect_lifecycle_stage`, `analyze_paths`) replace 3 of PostHog's custom UIs with AI reasoning over structured data.

## Notes

Evolution from simple event counter spec. Deep analysis (8 perspectives: strategy, product, privacy, architecture, DX, AI-native, data model, cost/ops) identified: MCP moat is thin without AI processing, no userId = 2/10 questions answerable, $0 cost is misleading ($3-8k/yr in dev time), storage exhausts in ~16 days at 100 DAU without TTL.

This spec addresses every critical finding: adds userId + sessions + funnels + retention + time-series + breakdowns + attribution, API authentication, GDPR deletion, data retention with archiving, properties validation, storage monitoring, and AI-in-the-processing-layer MCP tools.

## Timeline

| Action | Timestamp | Duration | Notes |
|--------|-----------|----------|-------|
| plan (PostHog) | 2026-03-19 | - | Created, then reviewed |
| spec-review (4 perspectives) | 2026-03-19 | - | Flagged HIGH risks → pivot |
| plan (Convex event counter) | 2026-03-19 | - | Simple component |
| deep analysis (8 perspectives) | 2026-03-19 | - | vs GA4/PostHog/Plausible/Mixpanel |
| plan (full analytics engine) | 2026-03-19 | - | This spec — 5 phases, ~44h |
