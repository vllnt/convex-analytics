# AI Agent Guide — convex-analytics

## Quick Start

```bash
pnpm install        # Install deps (pnpm 9+ required)
pnpm build          # Build all packages
pnpm test           # Run all tests
pnpm typecheck      # Type-check all packages
pnpm lint           # Lint all packages
```

## Documentation

- Full docs: `docs/` directory (7 files — schema, API, SDK, architecture, MCP, multi-product)
- AI context: `llms.txt` (navigation) or `llms-full.txt` (all docs inline)
- Contributing: `CONTRIBUTING.md`

## Tech Stack

- TypeScript 5.7, strict mode
- Convex (backend-as-a-service — reactive database + serverless functions)
- Turborepo (monorepo orchestration)
- Vitest + convex-test (testing)
- pnpm 9 (package manager — enforced via preinstall hook)

## Architecture

```
track() call
  → rate limiter (100/min per session, token bucket)
  → validate event name (/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/)
  → filter properties against event_schemas (if registered)
  → upsert session (seqNum from eventCount — TOCTOU-safe)
  → insert event
  → upsert user
  → aggregate insert (namespace: "name:YYYY-MM-DD")
  → sharded counter increment (16 shards)

Crons (background):
  rollup (5min)          → daily_rollups with dimension breakdowns
  closeInactiveSessions  → close after 30min inactivity
  ttlCleanup (daily)     → delete events past retention period
  monitor (weekly)       → storage usage warnings
  rebalance (weekly)     → verify counter accuracy
```

## Package Layout

| Package | Purpose |
|---------|---------|
| `packages/convex-analytics` | Core Convex component (npm: @vllnt/convex-analytics): schema, mutations, queries, HTTP API |
| `packages/convex-analytics-mcp` | MCP server: 12 tools for AI-native analytics queries |
| `demo/` | Demo Convex app for testing |

## Code Conventions

- Explicit return types on exported functions
- `v.string()`, `v.number()`, etc. for Convex validators (not Zod)
- Indexes defined in `schema.ts` — always use `.withIndex()` for queries
- No `.collect()` on large tables — use `.take(limit)` with indexes
- Mutations return `v.null()` explicitly
- HTTP endpoints use `httpAction()` with `x-api-key` auth header

## Database Tables (7)

| Table | Purpose | Key Indexes |
|-------|---------|-------------|
| `events` | Raw event storage | by_name_time, by_user_time, by_session, by_project_name |
| `sessions` | Session lifecycle | by_user, by_time, by_session |
| `users` | Visitor profiles | by_visitor, by_firstSeen, by_lastSeen |
| `daily_rollups` | Pre-aggregated daily stats | by_name_date, by_project_date, by_date |
| `event_schemas` | Property validation rules | by_name |
| `config` | Runtime configuration | by_key |
| `archives` | Archived event files | by_date |

## Safe to Edit

- `packages/convex-analytics/src/client.ts` — public TypeScript API
- `packages/convex-analytics/src/component/track.ts` — event ingestion
- `packages/convex-analytics/src/component/queries.ts` — analytics queries
- `packages/convex-analytics/src/component/api.ts` — REST endpoints
- `packages/convex-analytics/src/component/crons.ts` — background jobs
- `packages/convex-analytics/src/component/config.ts` — config management
- `packages/convex-analytics-mcp/src/server.ts` — MCP tool definitions
- `packages/convex-analytics/tests/**` — test files

## Do Not Edit

- `packages/convex-analytics/src/component/_generated/*` — Convex codegen
- `pnpm-lock.yaml` — auto-maintained
- `node_modules/` — auto-maintained

## Common Workflows

### Add a new dimension

1. Add field to `events` table in `schema.ts`
2. Add index `by_name_{dim}` in `schema.ts`
3. Add to `TrackMetadata` in `client.ts`
4. Add to `trackArgs` in `validators.ts`
5. Handle in `track()` mutation in `track.ts`
6. Add to rollup dimension loop in `crons.ts`
7. Add to `Dimension` type in `client.ts`
8. Add test in `tests/`

### Fix a bug in queries

1. Read the failing query in `queries.ts`
2. Check which index it uses in `schema.ts`
3. Fix the logic
4. Add regression test in `tests/queries.test.ts`
5. Run `pnpm test` to verify

### Add a new REST endpoint

1. Add handler in `api.ts` (use `httpAction()` + `requireApiKey()`)
2. Add backing query/mutation in `queries.ts` or `track.ts`
3. Add test coverage
4. Document in `docs/api-reference.md`

## Known Limitations

1. Funnel query scans up to 10,000 first-step events — not suitable for very high-volume funnels
2. Retention uses `lastSeen` approximation, not per-event return tracking
3. Alias reassignment is paginated (500/batch) — large user merges may take multiple mutation calls
4. Rollup cron processes last 10min of events — events older than that on first run won't be rolled up
5. Sharded counter can drift from actual count — `rebalance` cron detects but doesn't auto-correct
