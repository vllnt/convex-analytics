# convex-analytics rebuild — design (generic core + opt-in web preset)

Rebuild the web-locked 0.1.0 into a **generic, configurable, domain-neutral**, rollup-on-write
analytics component. Any event, any dimension, any domain. **Web is an opt-in preset, never baked in.**
"Handle more use cases" = the same rich verb set (timeseries, top, funnel, retention, uniques) working
for ANY event/dimension/domain, not just web.

## The 4 generic seams

1. **Free-string `name`** — any event (`"page_view"`, `"match_resolved"`, `"invoice_paid"`).
2. **Opaque `subjectRef` / `sessionRef`** — strings; never assumed to be a user/session of any shape.
3. **Host-supplied props validator** — client is generic `AnalyticsClient<TProps>`; runtime default is a
   typed `v.record(v.string(), scalar)` (scalar = string|number|boolean|null). **Never `v.any()`.** A host
   may pass a stricter `propsValidator` to narrow at the boundary.
4. **Host-declared `dimensions`** — `string[]` of prop keys to roll up on; drives rollup-on-write. NOT a
   fixed web-field set.

## Config — client-owned (+ a tiny config table for crons)

```ts
new AnalyticsClient(components.analytics, {
  scope?: string,          // multi-tenant partition. default "default"
  dimensions?: string[],   // prop keys to roll up on. default [] (count by event name only = zero-config)
  granularities?: ("minute"|"hour"|"day")[],  // rollup buckets. default ["day"] (minute opt-in)
  retentionDays?: number,  // raw-event TTL. default 90 (rollups kept forever)
  sampleRate?: number,     // 0..1. default 1
  propsValidator?,         // optional host validator narrowing props at the boundary
})
```

Cron-relevant config (retentionDays, sampleRate) is persisted to the `config` table via
`client.configure(ctx, {...})` so the in-component prune cron can read it. Dimensions/granularities are
passed per call from the client (no per-track config read).

## Schema (generic — zero hardcoded web, zero `v.any()`)

- **`events`** `{ scope, name, subjectRef?, sessionRef?, props (record<string,scalar>), ts, seq, dedupeKey? }`
  — indexes `by_scope_name_ts`, `by_scope_subject_ts`, `by_scope_session_ts`, `by_dedupe`. TTL-pruned.
- **`rollups`** `{ scope, name, granularity, bucket, dim, val, count }` — indexes
  `by_scope_name_gran_bucket_dim`, `by_scope_name_dim_val`. `dim=""`,`val=""` = the **total** row.
  Rollup-on-write: for each host-declared dimension present in `props`, increment
  `(scope,name,gran,bucket,dim,val)` + the total row.
- **`subjects`** `{ scope, subjectRef, firstSeen, lastSeen, eventCount }` — for uniques/retention/lifecycle
  (no web fields).
- **`config`** `{ scope, key, value }` — retention/sampling for crons (set via `configure`).
- Child components kept: `@convex-dev/aggregate` (range counts), `@convex-dev/sharded-counter`
  (O(1) totals), `@convex-dev/rate-limiter` (per-`sessionRef`, configurable).

## API verbs (generic; this is the "more use cases")

| Verb | Use |
|------|-----|
| `track(ctx, name, { subjectRef?, sessionRef?, props?, ts?, scope?, dedupeKey? })` | ingest — rollup-on-write + raw event + counter; sampling + dedupe applied |
| `metric(ctx, name, { range?, scope?, where? })` | total count over a range, optionally filtered by a dimension value |
| `top(ctx, name, dimension, { range?, limit?, scope? })` | top values of a dimension (breakdown) |
| `timeseries(ctx, name, { granularity, range, where?, scope? })` | bucketed counts |
| `uniques(ctx, { range, granularity, scope? })` | DAU/WAU/MAU from subjects |
| `funnel(ctx, steps[], { range, scope? })` | ordered step conversion (generic) |
| `retention(ctx, { cohortRange, periods, scope? })` | cohort return rates (generic) |
| `distribution(ctx, name, measure, { buckets, range?, where?, scope? })` | histogram over a numeric measure (declared upper-bound bins + overflow, with count/sum) |
| `list(ctx, name, paginationOpts, { scope? })` | paginated raw events |
| `configure(ctx, { retentionDays?, sampleRate? })` | persist cron config |

## Web preset — opt-in (`@vllnt/convex-analytics/web`)

A config bundle + host-side helpers (NOT in the sandboxed component):
- `webDimensions = ["path","referrer","device","browser","os","country","utmSource","utmMedium","utmCampaign"]`
  — pass to `dimensions` to opt in.
- helpers: `parseUserAgent(ua) → {device,browser,os}`, `geoFromHeaders(h) → {country,region,city}`,
  `trackPageview(client, ctx, {...})` convenience.
- Off by default. The generic core has ZERO web fields. Segment `identify`/`alias` dropped from core (an
  optional generic `mergeSubject` helper can stitch refs if a consumer needs it).

## Crons (inside the component, idempotent)

- `prune` — daily, delete raw events past `retentionDays` (rollups kept forever).
- `closeSessions` — close sessions idle past a configurable timeout.
- Rollup is **on-write** (accurate, no 5-min lag) — the old rollup cron is dropped; an optional
  `backfill` mutation re-derives rollups from raw events if needed.

## Bring the repo to the type-A standard (alongside the rebuild)

- vitest → **edge-runtime** + `coverage.thresholds` 100 + `test:coverage` script; **register the child
  components** in tests so `track` is E2E-testable.
- package.json: `engines`, `publishConfig`, `author` object, `funding`, `sideEffects`, `preversion`,
  `homepage`, `bugs`, `repository`, the exports map (`./convex.config`,
  `./_generated/component.js`, `./test`, `./web`).
- `convex.json`; the tsconfig set; keep the monorepo (turbo) but each package green.
- HTTP layer stays optional; genericize `/track` (move UA/geo parsing to the web preset).

## Docs (updated in lockstep)

- README: the generic-core-vs-web-preset split, the FULL config surface, the verb table, an honest
  config section (fixes the current "documents config the code ignores" gap).
- `docs/`: `schema.md` (generic), `client-sdk.md` (real config + verbs), `config.md`, `multi-product.md`
  (scope), `web-preset.md`. `llms.txt`, `AGENTS.md`/`CLAUDE.md`.

## Out of scope (record the call)

- ClickHouse export outbox — deferred (roadmap `convex-analytics.6`); the predefined-dimension rollups +
  raw-event TTL are the v0.1 boundary. Ad-hoc/retroactive funnels beyond the retention window are a later
  export concern.
