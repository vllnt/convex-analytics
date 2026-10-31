# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - Unreleased

### Fixed

- Reject clearly invalid input with typed `ConvexError` codes (`EMPTY_STRING`,
  `INVALID_TIMESTAMP`, `INVALID_SAMPLE_RATE`, `INVALID_PROP_VALUE`, `INVALID_PROP_KEY`,
  `INVALID_COUNT`, `INVALID_CURSOR`, `INVALID_BUCKETS`, `INVALID_CONFIG`): `NaN` or infinite
  `ts`, range bounds, `sampleRate` and number props; empty `scope`, `name`, `subjectRef`,
  `sessionRef`, `dedupeKey`, dimensions and config keys; non-scalar props; non-positive or
  non-integer `limit`, `periods` and `numItems`; and non-numeric `list` cursors. A negative
  `top` limit used to return all but the last rows; non-finite timestamps used to create `NaN`
  rollup buckets.
- `configure` rejects non-positive `retentionDays` and `sessionIdleMs`, which would otherwise
  make `prune` delete every event.
- Inherited keys such as `constructor` are no longer rolled up as dimensions.
- The REST routes return `400 { error, code }` for typed input errors, non-object bodies,
  malformed `dimensions` / `granularities` / `props`, and non-numeric `from`, `to` or `limit`
  (blank or malformed values used to widen the range silently); a malformed stored `apiKeys`
  value returns `500` with a clear message instead of an unhandled exception.
- `metric`, `top` and `timeseries` read only the rollup buckets in the requested range, and
  `uniques` reads only subjects active in range through a new `by_scope_lastSeen` index.
- Add `.js` extensions to every relative import in `src/` so `@vllnt/convex-analytics/test`
  type-checks under `moduleResolution: nodenext`.

### Changed

- Release flow: stable versions publish only from a pushed `vX.Y.Z` tag on `main` through
  `.github/workflows/publish.yml` (npm trusted publishing with provenance); actions are pinned
  to commit SHAs. The changelog now lives in `packages/convex-analytics/`.
- Tooling: pnpm 10 with a release-age gate and blocked install scripts; trimmed dependency
  overrides.
- Docs: input-error table, PII guidance, and an explicit statement that the component never
  logs event data.

## [0.1.0] - 2026-09-01

First stable release (the earlier `0.1.0-canary.*` builds were published from June 2026).
The component is a **generic, domain-neutral** analytics core —
the earlier web-locked draft was replaced before any public release, so the generic rebuild
is folded into this single `0.1.0` entry.

### Added

- **Generic core** — free-string event `name`, opaque `subjectRef` / `sessionRef`, host-typed
  scalar `props` (no `v.any()`), and host-declared `dimensions`. Zero hardcoded domain.
- **Rollup-on-write** — counts are incremented as events land, so `metric` / `top` /
  `timeseries` read in O(1) (backed by `@convex-dev/aggregate` + `@convex-dev/sharded-counter`).
- **Verb set** — `track`, `metric`, `top`, `timeseries`, `uniques`, `funnel`, `retention`,
  `distribution`, `list`, `configure`; all generic across any event / dimension / domain.
- **Distribution** — `distribution(name, measure, { buckets })` is a histogram over a numeric
  `props` measure (declared upper-bound bins + overflow, with `count` / `sum`), computed from
  raw events in range (index-backed, bounded).
- **Granularities** — `minute` / `hour` / `day` rollup buckets (`minute` opt-in for short live
  windows), end-to-end through `track`, the read verbs, and the REST routes.
- **Config surface** — `scope`, `dimensions`, `granularities`, `retentionDays`, `sampleRate`,
  `sessionIdleMs`, `propsValidator`; sensible defaults, zero config required. Config is
  applied (not ignored) — `dimensions` / `granularities` / `sampleRate` per call, retention /
  sampling / idle persisted for the crons via `configure`.
- **Opaque `scope` partition** on every table, mutation, and query for multi-tenant isolation.
- **Per-session rate limiting, dedupe, and sampling** built into `track`.
- **Schema** — five sandboxed tables (events, rollups, subjects, sessions, config); raw events
  TTL-pruned, rollups kept forever.
- **Crons** — daily `prune` (raw-event TTL) and `closeSessions` (idle close), idempotent;
  plus a `backfill` mutation to re-derive rollups.
- **Web preset** — opt-in `@vllnt/convex-analytics/web`: `webDimensions`, `parseUserAgent`,
  `geoFromHeaders`, `trackPageview`. The generic core carries no web fields.
- **React hooks** — optional `@vllnt/convex-analytics/react`: `useMetric`, `useTop`,
  `useTimeseries`, `useUniques` over the host's re-exported aggregate query refs.
- **REST API** — five generic `x-api-key`-authed routes (/track, /metric, /top, /timeseries,
  /uniques), timing-safe key comparison.
- **Testing** — `@vllnt/convex-analytics/test` export for convex-test, registering the child
  components so `track` is exercised end-to-end.

### Fixed (since the first canary)

- Register automatic session-closing and event-retention cron jobs, including zero-config scopes.
- Seek expired events by `(scope, ts)`, page scope discovery, and bound/reschedule maintenance at
  500 rows per transaction.
- Preserve valid rollups when backfill input exceeds its supported 50,000-event bound instead of
  deleting them and silently rebuilding from truncated input.
- Count funnel subjects through later valid repeated steps, isolate rate limits and counters with
  collision-safe tuple keys, and reopen sessions without moving `lastTs` backward.

### Changed (since the first canary)

- Treat Convex `_generated` output as CLI-owned, exclude it from formatting, and expose a
  dedicated codegen script.
- Adopt the stable v2 vllnt toolchain, TypeScript 7 validation, Convex 1.45,
  `convex-test` 0.0.56, and the latest compatible direct dependencies.
- Use explicit table names for Convex database patch/delete operations.
