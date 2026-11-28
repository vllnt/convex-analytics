# @vllnt/convex-analytics

A generic, configurable, domain-neutral analytics component for Convex, with rollup-on-write.
Any event, any dimension, any domain. Follows the vllnt Component Standard (see the
`oss-packages` hub `AGENTS.md`).

## Agent instructions

`AGENTS.md` is the sole agent-instruction source for this repository. Do not add
`CLAUDE.md` or `.claude` content.

## Package structure

This repo is a small monorepo (turbo) holding the core analytics component.

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
        schema.ts              # events, rollups, subjects, sessions, scopes, config (sandboxed)
        convex.config.ts       # defineComponent("analytics") + aggregate/shardedCounter/rateLimiter
        mutations.ts           # track, configure, configSet
        queries.ts             # metric, top, timeseries, uniques, funnel, retention, distribution, list, configGet
        internal_mutations.ts  # crons: prune, closeSessions; backfill
        http.ts                # five generic x-api-key REST routes
        validators.ts          # shared validators (typed scalar props — no v.any())
```

## Ownership boundary

| Concern | Owner |
|---------|-------|
| Event store + rollups + subject/session lifecycle (track, read verbs, retention) | **Component** |
| `events`, `rollups`, `subjects`, `sessions`, `scopes`, `config` sandboxed tables | **Component** |
| Rollup-on-write aggregation, crons (prune, closeSessions) | **Component** |
| Subject / session identity, auth / authz, API-key gating policy | **Host** |
| Meaning of `name`, `subjectRef`, `sessionRef`, and each `props` key | **Host** |
| Which prop keys are rolled up (`dimensions`) | **Host** (config) |
| Domain semantics, web/mobile concepts, vendor/provider | **Host** (web is an opt-in preset) |

The component never reads host or sibling tables. Host data enters only as opaque strings
(`subjectRef`, `sessionRef`) or host-typed scalar `props`.

## Key design decisions

- **Four generic seams.** (1) Free-string `name` — any event. (2) Opaque `subjectRef` /
  `sessionRef` — never assumed to be a user/session of any shape. (3) Host-typed props — the
  client is `AnalyticsClient<TProps>` (compile-time only); the runtime validator is a typed
  `v.record(v.string(), scalar)`, never `v.any()`. There is no `propsValidator` option.
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
  `top` / `timeseries` read the pre-aggregated rows (cost grows with matching buckets and
  values; only the unfiltered lifetime `metric` is a fixed-shard counter read); there is no
  rollup lag.
  `backfill` re-derives rollups from raw events when dimensions change. `funnel` /
  `distribution` are computed from raw events at query time (index-backed, bounded) and
  `retention` from `subjects` first/last-seen rows — the
  histogram `distribution(name, measure, { buckets })` buckets a numeric `props` measure with an
  overflow bin.
- **Web is a preset, never baked in.** The sandboxed core has zero web fields. The web layer
  (`webDimensions`, `parseUserAgent`, `geoFromHeaders`, `trackPageview`) is pure host-side
  helpers in `@vllnt/convex-analytics/web`; a host opts in by passing `webDimensions` to
  `dimensions`. Segment-style `identify`/`alias` were dropped from the core.
- **Config is applied, not ignored.** The earlier draft documented config the code ignored.
  Now `dimensions` / `granularities` / `sampleRate` ride into each `track` call, and
  `retentionDays` / `sessionIdleMs` are persisted to the `config` table via `configure` so the
  in-component crons read them (`configure` also stores `sampleRate`, which nothing reads). All defaults work with
  zero config.
- **Opaque `scope` partition.** Every table, index, mutation, and query leads with `scope` so
  non-scoped reads never span partitions. Default `"default"`; overridable per call. For a
  static set of partitions, multi-mount (`app.use(analytics, { name })`) is also supported.
- **Zero `v.any()`.** `props` is a typed `record<string, scalar>` end to end; host typing is
  via the `TProps` generic.
- **Optional `./react` layer.** Hooks wrap `convex/react`'s `useQuery` over the host's
  re-exported aggregate query refs (`metric`, `top`, `timeseries`, `uniques`) — typed for
  aggregate results only; access control and `scope` belong to the host query. `react` is an optional peer dep (`convex` is
  required) and only `./react` imports it. Backend-only consumers can still get React installed:
  `@convex-dev/aggregate` 0.3.4 depends on `@convex-dev/batch-worker` 0.3.3, which declares
  `react` as a required peer, so package managers may install it. Render-tested and coverage-included at 100%.
- **Auth-agnostic.** No auth library assumed. The host resolves identity, gates access, and
  passes opaque refs in. REST routes gate on an `x-api-key` matching the host-configured
  `apiKeys` config row (the loop does not stop at the first differing character).

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts`; crons in `internal_mutations.ts`.
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host-supplied validator — never `v.any()`.
- Runtime deps: only official `@convex-dev/*` (aggregate, sharded-counter, rate-limiter).
- Dependency age gate: `minimumReleaseAge` (7 days) and `minimumReleaseAgeExclude` live in
  `pnpm-workspace.yaml`; pnpm 10 ignores them under `package.json` `pnpm`.
- This is a monorepo; each package stays green independently (`pnpm typecheck`, `pnpm test`).

## Commands

```bash
pnpm install        # install all workspace deps (pnpm 10)
pnpm build          # build all packages (turbo)
pnpm test           # run all tests (vitest via turbo)
pnpm typecheck      # type-check all packages
pnpm lint           # lint all packages
```

## Docs sync

| Doc | Owns |
|-----|------|
| `README.md` | Fixed agent-first sections (checked by `scripts/check-documentation.mjs`): when to use, install, quick start, API table, common tasks, errors and fixes, limits, compatibility, testing, security, links |
| `docs/client-sdk.md` | Full `AnalyticsClient<TProps>` config + verb reference + types, `./convex.config`, `./test` |
| `docs/schema.md` | The six sandboxed tables + indexes |
| `docs/api-reference.md` | The five generic REST routes |
| `docs/web-preset.md` | Opt-in web dimensions + UA/geo helpers |
| `docs/react.md` | `./react` hooks reference |
| `docs/multi-product.md` | The opaque `scope` partition |
| `docs/architecture.md` | Rollup-on-write, child components, crons |
| `docs/quick-start.md` | Install → mount → track → read walkthrough |
| `llms.txt` | curated index — `convex@^1.45.0` must match `package.json` `peerDependencies.convex` |
| `AGENTS.md` | canonical agent instructions (this file) |
| `packages/convex-analytics/CHANGELOG.md` | Keep-a-Changelog entry per release |

After any source, README, or docs change, update the root `llms.txt` index if links or package
context changed. Keep one root `llms.txt`; do not generate a second index or a full-source bundle.
Grep stale values before committing.

The package build copies `README.md`, `LICENSE`, `llms.txt` and `docs/` into
`packages/convex-analytics/`, and `files` in its `package.json` ships the user pages (not
`docs/REBUILD.md`). `llms.txt` links are relative to the published package root, so
`./CHANGELOG.md` resolves there, not at the repository root. `pnpm --filter
@vllnt/convex-analytics test:package` (after `pnpm build`, run in CI) installs the packed
tarball and checks the required files, the excluded internal files, and every relative link.
It installs with pnpm, without a lockfile, under the `minimumReleaseAge` and
`minimumReleaseAgeExclude` it reads from the root `pnpm-workspace.yaml`.
Add a new user page to `files` and to `REQUIRED` in `scripts/test-package.mjs`.
It also imports every `exports` entry with plain Node (except the commented
`TYPE_CHECK_ONLY` entries) and type-checks a strict `nodenext` consumer importing from every
entry, without `skipLibCheck`: an error in the installed package's own `.d.ts` files fails, and
one in another package's declarations prints as an ignored `NOTE`; a new export needs a row in
`ENTRY_IMPORTS`. The publish `quality` job runs it before
both channels. `pnpm lint` also runs `scripts/test-check-package-contents.sh`, and
`pnpm typecheck` / `typecheck:ci` also check `tests/` and `vitest.config.ts`
(`tsconfig.test.json`; the build still compiles only `src`).
`test:package` also runs `scripts/check-documentation.mjs` on the installed docs: README
sections and order; the API table both ways (every export of every `exports` key except
`./package.json`, `.js` keys included, has a row, a TSDoc summary and a `docs/` heading, and
every row names an export of the entry points in its second cell, a public `AnalyticsClient`
method, or a `components.<name>.<file>` function of `ComponentApi`); the errors table against
every code and message in `src/`; each hard cap in `src/` (keyed by its enclosing export or
constant) stated by its exact `CAP_PHRASES` phrase in Limits and gotchas, with unknown and stale
entries failing; the Links block, footer and llms.txt Ecosystem block; and it type-checks every
README/docs `ts`/`tsx` example (a block starts with `// <path>.ts`, or `// signature` for a
non-compiled reference block in `docs/`).

## Generated code

- Every `**/_generated/**` file is owned exclusively by Convex CLI codegen.
- Never create, edit, lint, or format generated files manually.
- Run `pnpm codegen` to regenerate them and commit the generated output unchanged.
