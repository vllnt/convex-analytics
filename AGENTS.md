# @vllnt/convex-analytics

A generic, configurable, domain-neutral analytics component for Convex, with rollup-on-write.
Any event, any dimension, any domain. Follows the vllnt Component Standard (see the
`convex-components` hub `.claude/rules/component-standard.md`).

## Package structure

This repo is a small monorepo (turbo): the core component, an MCP server, and a demo host.

```
packages/
  convex-analytics/            # core component (npm: @vllnt/convex-analytics)
    src/
      shared.ts                # Scalar/Props/Granularity types + bucket/valKey helpers (pure)
      test.ts                  # convex-test register() helper (registers child components)
      client/
        index.ts               # AnalyticsClient<TProps> — the public API
        types.ts               # public TypeScript interfaces + AnalyticsConfig
      web/index.ts             # opt-in web preset (webDimensions, parseUserAgent, geoFromHeaders, trackPageview)
      react/index.tsx          # optional ./react hooks (useMetric/useTop/useTimeseries/useUniques)
      component/
        schema.ts              # events, rollups, subjects, sessions, config (sandboxed)
        convex.config.ts       # defineComponent("analytics") + aggregate/shardedCounter/rateLimiter
        mutations.ts           # track, configure, configSet
        queries.ts             # metric, top, timeseries, uniques, funnel, retention, distribution, list, configGet
        internal_mutations.ts  # crons: prune, closeSessions; backfill
        http.ts                # five generic x-api-key REST routes
        validators.ts          # shared validators (typed scalar props — no v.any())
  convex-analytics-mcp/        # MCP server (npm: convex-analytics-mcp) — 7 tools
demo/convex/                   # host harness (convex.config.ts + example.ts) — exercises the client
```

## Ownership boundary

| Concern | Owner |
|---------|-------|
| Event store + rollups + subject/session lifecycle (track, read verbs, retention) | **Component** |
| `events`, `rollups`, `subjects`, `sessions`, `config` sandboxed tables | **Component** |
| Rollup-on-write aggregation, crons (prune, closeSessions) | **Component** |
| Subject / session identity, auth / authz, API-key gating policy | **Host** |
| Meaning of `name`, `subjectRef`, `sessionRef`, and each `props` key | **Host** |
| Which prop keys are rolled up (`dimensions`) | **Host** (config) |
| Domain semantics, web/mobile concepts, vendor/provider | **Host** (web is an opt-in preset) |

The component never reads host or sibling tables. Host data enters only as opaque strings
(`subjectRef`, `sessionRef`) or host-typed scalar `props`.

## Key design decisions

- **Four generic seams.** (1) Free-string `name` — any event. (2) Opaque `subjectRef` /
  `sessionRef` — never assumed to be a user/session of any shape. (3) Host-supplied props
  validator — the client is `AnalyticsClient<TProps>`; the runtime default is a typed
  `v.record(v.string(), scalar)`, never `v.any()`; a host may pass a stricter `propsValidator`.
  (4) Host-declared `dimensions` — the `string[]` of prop keys to roll up on, not a fixed
  web-field set.
- **Entity/instance identity is the host's, kept opaque.** The component owns no host id. An
  entity you slice by (a puzzle, an org, a device) is a value in `props` under a host-declared
  dimension: "one instance" is a `where`-filtered `metric`/`timeseries`, "last-N instances" is
  `top` over that dimension, and once-per-outcome counting is the host's `dedupeKey`. We never
  model a host id (e.g. a `dailyNumber`) — that would re-bake a domain assumption.
- **Rollup-on-write, not a rollup cron.** `track` increments the `(scope, name, gran, bucket,
  dim, val)` rollup rows (a total row + one per declared dimension present in `props`) as the
  event lands across `minute`/`hour`/`day` buckets (minute opt-in for live windows). `metric` /
  `top` / `timeseries` read the pre-aggregated rows in O(1); there is no 5-minute rollup lag.
  `backfill` re-derives rollups from raw events when dimensions change. `funnel` / `retention` /
  `distribution` are computed from raw events at query time (index-backed, bounded) — the
  histogram `distribution(name, measure, { buckets })` buckets a numeric `props` measure with an
  overflow bin.
- **Web is a preset, never baked in.** The sandboxed core has zero web fields. The web layer
  (`webDimensions`, `parseUserAgent`, `geoFromHeaders`, `trackPageview`) is pure host-side
  helpers in `@vllnt/convex-analytics/web`; a host opts in by passing `webDimensions` to
  `dimensions`. Segment-style `identify`/`alias` were dropped from the core.
- **Config is applied, not ignored.** The earlier draft documented config the code ignored.
  Now `dimensions` / `granularities` / `sampleRate` ride into each `track` call, and the
  cron-relevant values (`retentionDays`, `sampleRate`, `sessionIdleMs`) are persisted to the
  `config` table via `configure` so the in-component crons read them. All defaults work with
  zero config.
- **Opaque `scope` partition.** Every table, index, mutation, and query leads with `scope` so
  non-scoped reads never span partitions. Default `"default"`; overridable per call. For a
  static set of partitions, multi-mount (`app.use(analytics, { name })`) is also supported.
- **Zero `v.any()`.** `props` is a typed `record<string, scalar>` end to end; host typing is
  via the `TProps` generic + optional host `propsValidator`.
- **Optional `./react` layer.** Hooks wrap `convex/react`'s `useQuery` over the host's
  re-exported aggregate query refs (`metric`, `top`, `timeseries`, `uniques`) — aggregates
  only, scope-gated, no raw events on the client. `react` + `convex` are optional peer deps;
  backend-only consumers pull zero React. Render-tested and coverage-included at 100%.
- **Auth-agnostic.** No auth library assumed. The host resolves identity, gates access, and
  passes opaque refs in. REST routes gate on an `x-api-key` matching the host-configured
  `apiKeys` config row, compared timing-safe.

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts`; crons in `internal_mutations.ts`.
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host-supplied validator — never `v.any()`.
- Runtime deps: only official `@convex-dev/*` (aggregate, sharded-counter, rate-limiter).
- This is a monorepo; each package stays green independently (`pnpm typecheck`, `pnpm test`).

## Commands

```bash
pnpm install        # install all workspace deps (pnpm 9+)
pnpm build          # build all packages (turbo)
pnpm test           # run all tests (vitest via turbo)
pnpm typecheck      # type-check all packages
pnpm lint           # lint all packages
```

## Docs sync

| Doc | Owns |
|-----|------|
| `README.md` | Value prop, features, generic-core-vs-web split, install, usage, config, API summary, web/react, security, testing |
| `docs/client-sdk.md` | Full `AnalyticsClient<TProps>` config + verb reference + types |
| `docs/schema.md` | The five sandboxed tables + indexes |
| `docs/api-reference.md` | The five generic REST routes |
| `docs/web-preset.md` | Opt-in web dimensions + UA/geo helpers + React note |
| `docs/multi-product.md` | The opaque `scope` partition |
| `docs/architecture.md` | Rollup-on-write, child components, crons |
| `docs/mcp-tools.md` | The 7 MCP tools |
| `docs/quick-start.md` | Install → mount → track → read walkthrough |
| `llms.txt` | curated index — `convex@>=1.21.0` must match `package.json` `peerDependencies.convex` |
| `AGENTS.md` | canonical agent instructions (this file) |
| `CLAUDE.md` | verbatim mirror of AGENTS.md |
| `CHANGELOG.md` | Keep-a-Changelog entry per release |

Grep stale values before committing (see `.claude/rules/docs-sync.md`).
