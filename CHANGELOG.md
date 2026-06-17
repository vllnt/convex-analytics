# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-06-14

Initial private pre-release. The component is a **generic, domain-neutral** analytics core —
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
