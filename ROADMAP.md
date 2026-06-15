# Roadmap — @vllnt/convex-analytics

> Embedded, real-time, rollup-on-write analytics for Convex — a domain-neutral generic core (any
> event, any dimension) with web analytics as an opt-in preset, never baked in.

**Now:** generic-core
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

## generic-core [ACTIVE]

**Goal:** Rebuild the web-locked 0.1.0 into the domain-neutral, maximally-configurable core — any
event, any dimension, zero `v.any()`, zero-config for any domain.
**Exit criteria:** the core ingests any event via the 4 seams with host-supplied validators and
host-declared dimensions, rolls up reactively on `@convex-dev/aggregate` + `sharded-counter`,
TTL-prunes raw events, and carries **no** hardcoded web fields or `v.any()` anywhere.

- [ ] generic-core.1 Scope doc — rollup-on-write, predefined-dimension only; ad-hoc/retroactive funnels + retention → ClickHouse export (not Convex). Drafted in `docs/REBUILD.md`
- [ ] generic-core.2 Standardized schema — `events` (TTL-pruned) + `rollups`, backed by `@convex-dev/aggregate` + `@convex-dev/sharded-counter`
- [ ] generic-core.3 The 4 generic seams + maximum configuration — `name` string, opaque `subjectRef`/`sessionRef`, host-supplied prop validators, host-declared `dimensions`/`buckets`/`retention`/`sampling`/`scopeRef`; every option removes a hardcoded assumption and has a working default (not knob-soup); no `v.any()`
- [ ] generic-core.4 Typed-generic client `AnalyticsClient<TEventMap>` + API verbs `track` / `metric` / `top` / `timeseries`
- [ ] generic-core.5 Retention/prune cron (raw days, rollups forever) + idempotent ingest (`dedupeKey`)
- [ ] generic-core.6 Strip the web-lock from the CORE — remove hardcoded web fields (`path`/`referrer`/`browser`/`os`/`device`/`country`/`utm*`/`locale`/`platform`) + the `users`/`sessions` web tables, drop Segment-style `identify`/`alias`, replace every `v.any()` with a host-supplied / typed-generic validator

## web-preset [PLANNED]

**Goal:** Ship web analytics as an opt-in configurable preset layered on the generic core — the
genericity proof (a game enables zero web config).
**Exit criteria:** pageview / session / UTM / device / `identify` ship as a documented preset, OFF
by default, composed entirely from core primitives (no special-casing in the core).

- [ ] web-preset.1 Web preset — pageview/session/UTM/device/`identify` as a documented opt-in preset on the generic core, off by default

## clickhouse-export [PLANNED]

**Goal:** Ship the export hatch for the ad-hoc / funnel / retention queries Convex can't serve.
**Exit criteria:** raw events flow to ClickHouse with buffer + flush + retry + dedup at the chosen
altitude, documented as the predefined-vs-export boundary.

- [ ] clickhouse-export.1 Decide outbox altitude — component (owns buffer + flush + retry + dedup) vs a `@vllnt/convex-helpers` thin client — and ship the chosen path

## scope-dimension [PLANNED]

**Goal:** Resolve multi-tenant partitioning for v0.1.
**Exit criteria:** an opaque `scopeRef` dimension (scoped indexes + scoped reads, default single
scope) ships, or the deferral is recorded with rationale.

- [ ] scope-dimension.1 Decide + implement the multi-tenant `scopeRef` dimension for v0.1, or defer (record the call)

## react-tooling [PLANNED]

**Goal:** Ship the optional, tree-shakeable `./react` client layer.
**Exit criteria:** `useMetric` / `useTimeseries` / `useTop` render-tested in jsdom, coverage-included
at 100%, no-leak (scopeRef-gated, aggregates only — never raw events or cross-subject data).

- [ ] react-tooling.1 Optional `./react` hooks `useMetric` / `useTimeseries` / `useTop` (no-leak: scopeRef-gated, aggregates only)

## first-release [PLANNED]

**Goal:** Publish `@vllnt/convex-analytics` 0.1.0 with a real second consumer.
**Exit criteria:** 0.1.0 on npm via OIDC `publish.yml` (provenance); ≥2 real consumers in unrelated
backends (stranger test — e.g. link-shortener click metrics + an `anthm-fr` game, not web-shaped the
same) at 100% E2E; README documents the generic-core-vs-web-preset split and the
predefined-vs-export boundary.

- [ ] first-release.1 Name + wire the 2nd real consumer (stranger test) at 100% E2E
- [ ] first-release.2 Docs — README documents the generic-core-vs-web-preset split, the full config surface + defaults, the predefined-vs-export boundary, and the events-vs-analytics distinction; regenerate `llms-full.txt`
- [ ] first-release.3 Publish 0.1.0 via the standard OIDC `publish.yml` (provenance)

## Non-goals — out of the generic core

- **Ad-hoc / retroactive funnels, retention, uniques over arbitrary dimensions** → the ClickHouse export hatch, not Convex. Convex serves predefined-dimension rollups reactively; the rest is the export's job.
- **Any domain assumption in the core** → web (and any future flavor) is an opt-in preset, never baked in.
- **Payment / identity / auth** → host concern; the component takes opaque refs and host-supplied validators only.

## Later

- Additional domain presets (mobile, file, …) layered on the generic core — only on a real consumer ask.
- `convex-analytics-mcp` (the repo's second package) tracks its own surface separately from the component roadmap above.
