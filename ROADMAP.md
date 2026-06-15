# Roadmap — @vllnt/convex-analytics

> Embedded, real-time, rollup-on-write analytics for Convex — a domain-neutral generic core (any
> event, any dimension) with web analytics as an opt-in preset, never baked in.

**Now:** first-release — generic core + presets + react shipped (100% E2E); adopting the public canary `0.1.0`
**Last updated:** 2026-06-15

> **Design (first principles):** the web-locked 0.1.0 (audit 2026-06-13 — hardcoded
> `path`/`referrer`/`browser`/`utm*` fields, Segment-style `identify`/`alias`, `v.any()` everywhere,
> fixed-index dimensions) was a vertical wearing a horizontal name. The rebuild is a **generic core**
> made agnostic by **4 seams** — free-string `name`, opaque `subjectRef`/`sessionRef`, a
> host-supplied props validator (`AnalyticsClient<TProps>`), and host-declared rollup dimensions —
> built on `@convex-dev/aggregate` + `@convex-dev/sharded-counter`. Convex serves
> **predefined-dimension rollups reactively**; ad-hoc / retroactive funnels, retention, and uniques
> over arbitrary dimensions are the **ClickHouse export hatch's** job, not Convex's. Web is one
> opt-in preset layered on the core. Full design: [`docs/REBUILD.md`](docs/REBUILD.md).

## generic-core [DONE 2026-06]

**Goal:** Rebuild the web-locked 0.1.0 into the domain-neutral, maximally-configurable core — any
event, any dimension, zero `v.any()`, zero-config for any domain.
**Exit criteria:** the core ingests any event via the 4 seams with host-supplied validators and
host-declared dimensions/measures, rolls up reactively on `@convex-dev/aggregate` + `sharded-counter`
across minute/hour/day buckets, TTL-prunes raw events, and carries **no** hardcoded web fields or
`v.any()` anywhere; writes stay **bounded** (no unbounded per-event fan-out), reads are
**index-backed** (no table scans), and serving rollups are **rebuildable from raw** via `backfill`.

- [x] generic-core.1 Scope doc — rollup-on-write, predefined-dimension only; ad-hoc/retroactive funnels + retention → ClickHouse export (not Convex). Drafted in `docs/REBUILD.md`
- [x] generic-core.2 Standardized schema — `events` (TTL-pruned) + `rollups`, backed by `@convex-dev/aggregate` + `@convex-dev/sharded-counter`
- [x] generic-core.3 The 4 generic seams + maximum configuration — `name` string, opaque `subjectRef`/`sessionRef`, host-supplied prop validators, host-declared `dimensions`/`measures` (numeric)/`granularities` (`minute`|`hour`|`day`)/`buckets`/`retention` (per-granularity tiers)/`sampling`/`scopeRef`; every option removes a hardcoded assumption and has a working default (not knob-soup); no `v.any()`
- [x] generic-core.4 Typed-generic client `AnalyticsClient<TEventMap>` + the generic verb set (structured-JSON out, delegable from `convex-analytics-mcp`): `track` / `metric` / `top` / `timeseries` / `uniques` / `funnel` (predefined ordered steps) / `retention` / `distribution` (histogram over a numeric measure) / `list` / `configure` — single-entity summary+series and cross-entity range (last-N) both covered
- [x] generic-core.5 Retention/prune cron (raw past `retentionDays`, rollups kept forever) + idempotent ingest (`dedupeKey`) — a terminal/outcome event counts once per (`subjectRef`, `dedupeKey`); a client refresh or retried mutation never double-counts
- [x] generic-core.6 Strip the web-lock from the CORE — remove hardcoded web fields (`path`/`referrer`/`browser`/`os`/`device`/`country`/`utm*`/`locale`/`platform`) + the `users`/`sessions` web tables, drop Segment-style `identify`/`alias`, replace every `v.any()` with a host-supplied / typed-generic validator
- [x] generic-core.7 Numeric measures + `distribution` verb — `distribution(name, measure, { buckets, range?, where? })` = histogram over a numeric `props` measure (declared upper-bound bins + overflow, with `count`/`sum` → mean), computed from raw events (index-backed, bounded — like `funnel`/`retention`). The #31 attempts-1..N case. (Measure-sum-on-write rollups deferred — query-from-raw covers v0.1)
- [x] generic-core.8 Minute granularity — `Granularity` is now `"minute"|"hour"|"day"`; `track`/`backfill`/`timeseries`/`uniques`/`retention` accept it (shared `granularitiesValidator`). Default granularities unchanged (`["day"]`); a consumer opts into `["minute"]` or `["hour","day"]` per their needs (the #31 live-window case). (Per-granularity retention tiers deferred — `retentionDays` is a single raw-event TTL)
- [x] generic-core.9 Entity/instance identity = opaque host dimension value (+ `dedupeKey`/`seq`), NOT a component-owned id — "query one instance" and "last-N instances" are `top` + `where`-filtered `metric`/`timeseries`. The component never models a host id (e.g. a `dailyNumber`). Documented: `docs/client-sdk.md` › *Identifying entities* + an AGENTS.md design decision

## web-preset [DONE 2026-06]

**Goal:** Ship web analytics as an opt-in configurable preset layered on the generic core — the
genericity proof (a game enables zero web config).
**Exit criteria:** pageview / session / UTM / device / `identify` ship as a documented preset, OFF
by default, composed entirely from core primitives (no special-casing in the core).

- [x] web-preset.1 Web preset — pageview/session/UTM/device/`identify` as a documented opt-in preset on the generic core, off by default (`src/web/index.ts` + `web.test.ts`)

## scope-dimension [DONE 2026-06]

**Goal:** Resolve multi-tenant partitioning for v0.1.
**Exit criteria:** an opaque `scopeRef` dimension (scoped indexes + scoped reads, default single
scope) ships, or the deferral is recorded with rationale.

- [x] scope-dimension.1 Multi-tenant `scopeRef` shipped as the opaque `scope` partition — every table/index/arg leads with `scope` (default `"default"`, overridable per call), non-scoped reads never span partitions, and static partition sets also work via multi-mount (`app.use(analytics, { name })`)

## react-tooling [DONE 2026-06]

**Goal:** Ship the optional, tree-shakeable `./react` client layer.
**Exit criteria:** `useMetric` / `useTimeseries` / `useTop` render-tested in jsdom, coverage-included
at 100%, no-leak (scopeRef-gated, aggregates only — never raw events or cross-subject data).

- [x] react-tooling.1 Optional `./react` hooks (`useMetric` / `useTop` / `useTimeseries` / `useUniques`) — aggregates only, scope-gated, render-tested in jsdom, coverage-included at 100% (`src/react/index.tsx` + `react.test.tsx`)

## first-release [ACTIVE]

**Goal:** Ship `@vllnt/convex-analytics` as the public **canary-only `0.1.0`** — the fleet release
policy (mirrors the `convex-components` hub *Version hold*): public **and** canary, never a stable
bump, so the package gets dogfooded before it's blessed. Ship all build phases first, *then* release.
**Exit criteria:** all build phases above (`generic-core` → `react-tooling`) shipped and CI-green at
100% E2E; the repo is **public**; `publish.yml` carries the fleet-standard **canary** job (gated on
`CANARY_ENABLED=true`, OIDC trusted publishing + `--provenance`) auto-publishing `0.1.0-canary.<sha>`
on every qualifying push to `main`; npm `latest` resolves the first canary (npm requires a `latest`),
the `canary` tag advances per push; **the version stays pinned at `0.1.0` — no bump past it until the
owner cuts the first stable release** (`stable-release` below); README documents the
generic-core-vs-web-preset split + the predefined-vs-export boundary.

- [-] first-release.1 Name + wire the 2nd real consumer (stranger test) at 100% E2E → moved to `dogfood.1` (the 2nd consumer is validated by dogfooding the public canary, not a precondition of it)
- [x] first-release.2 Docs — README documents the generic-core-vs-web-preset split, the full config surface + defaults, the predefined-vs-export boundary (*What it serves*), and the events-vs-analytics distinction (authoritative in-app aggregate, complements a warehouse); `llms-full.txt` regenerated
- [x] first-release.3 Adopt the fleet-standard `publish.yml` **canary** job (replaced the disabled `workflow_dispatch` stub) — monorepo-aware (publishes `@vllnt/convex-analytics` + `convex-analytics-mcp` at pinned `0.1.0`), gated on `CANARY_ENABLED`, OIDC `--provenance`, `0.1.0-canary.<sha>` on push to `main`; `workflow_dispatch` for stable. **Owner runtime step:** flip `CANARY_ENABLED=true` + make the repo public to start canary publishing.

## dogfood [PLANNED]

**Goal:** Dogfood + validate the public canary `0.1.0` against real consumers before blessing it
stable — the genericity proof and the bug shakeout.
**Exit criteria:** ≥2 real consumers in genuinely-different org backends (stranger test — e.g.
link-shortener click metrics + an `anthm-fr` game, not web-shaped the same) run on the canary at
100% E2E; the full config surface + verbs are exercised against real domains; gaps/bugs found (incl.
anything from #31) are filed and resolved or recorded; the canary is stable in practice over a soak
window.

- [ ] dogfood.1 Name + wire the 2nd real consumer (stranger test) on the public canary at 100% E2E (moved from `first-release.1`) — automated genericity proof already landed (`tests/stranger.test.ts`); this task is the *production* adoption in a real org backend
- [x] dogfood.2 Dogfood log — verb set + config validated against ≥2 genuinely-different domains via `tests/stranger.test.ts`: a game (`round_played` + attempts distribution + minute live window + idempotent outcome) and a SaaS (`signup` + plan breakdown + revenue distribution) on ONE component, config-only differences, plus cross-scope isolation — all at 100% E2E. Gaps found while building were fixed in-line (minute granularity, `distribution` verb, REST minute support) rather than left as issues; the demo host harness (`demo/convex/example.ts`) exposes the verb. (Production *soak* across live apps = `dogfood.3`.)
- [ ] dogfood.3 Soak the canary (advance the `canary` tag per push) until stable in practice — no open release-blocker

## stable-release [PLANNED]

**Goal:** Cut the first **stable** release — the owner blesses the dogfooded canary, lifting the
`0.1.0` canary-only hold.
**Exit criteria:** the owner cuts the first stable release via `publish.yml`'s `workflow_dispatch`
(bump current/patch/minor/major) — version, changelog-from-commits, tag `vX.Y.Z`, `gh release`, npm
publish `--provenance`; npm `latest` moves to the stable version; CHANGELOG entry written.

- [ ] stable-release.1 Owner cuts the first stable release (lifts the canary-only hold) via the standard `workflow_dispatch` path — version, changelog-from-commits, tag, `gh release`, npm publish `--provenance`

## clickhouse-export [PLANNED]

**Goal:** Ship the export hatch for the ad-hoc / retroactive funnel / retention / uniques queries (non-declared dimensions or beyond the raw-retention window) Convex can't serve.
**Exit criteria:** raw events flow to ClickHouse with buffer + flush + retry + dedup at the chosen
altitude, documented as the predefined-vs-export boundary.

> **Deferred — post-canary (decision 2026-06-15).** The v0.1 boundary is predefined-dimension
> rollups + the raw-retention window; the export hatch is a later feature, not a canary/stable
> blocker. Sequenced after the release tail so "ship all build phases" never waits on it.

- [-] clickhouse-export.1 DECIDED (2026-06-15) — **defer the export hatch to post-canary.** The decision task is resolved: not a v0.1 build. Rationale: the canary's boundary is predefined rollups + raw retention; the flush/retry execution must compose official `@convex-dev/action-retrier` + crons (not hand-rolled — official-dup gate); its only E2E path is a mocked external sink. Altitude when built: an in-component flush cron over the component's own `events` + an export cursor, composing the official retrier.

## Non-goals — out of the generic core

- **Ad-hoc / retroactive funnels, retention, uniques over *non-declared* dimensions or *beyond the raw-retention window*** → the ClickHouse export hatch, not Convex. Predefined-step funnels, cohort retention, uniques, and distributions over **host-declared** dimensions/measures are served **in-core** (rollup-on-write, reactively — they already ship as core verbs); only the arbitrary/retroactive remainder is the export's job.
- **Any domain assumption in the core** → web (and any future flavor) is an opt-in preset, never baked in.
- **Payment / identity / auth** → host concern; the component takes opaque refs and host-supplied validators only.

## Later

- Additional domain presets (mobile, file, …) layered on the generic core — only on a real consumer ask.
- `convex-analytics-mcp` (the repo's second package) tracks its own surface separately from the component roadmap above.
