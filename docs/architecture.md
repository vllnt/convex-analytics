# Architecture

## Write Path

Full `track()` flow:

```
track(ctx, userId, sessionId, name, properties, metadata)
  |
  +- 1. Rate limit (token bucket: 100/min per sessionId, burst 10)
  |     +-- Exceeded? -> return null (silent drop, no error)
  |
  +- 2. Validate event name: /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/
  |     +-- Invalid? -> throw Error
  |
  +- 3. Filter properties against event_schemas (if registered)
  |     +-- Unknown keys -> silently dropped
  |     +-- Type mismatch -> silently dropped
  |
  +- 4. Upsert session (TOCTOU-safe: seqNum derived from eventCount)
  |     +-- Existing -> patch eventCount++, exitPath, endTime
  |     +-- New -> insert full session record
  |
  +- 5. Insert event (seqNum from step 4)
  |
  +- 6. Upsert user
  |     +-- Existing -> patch lastSeen, totalEvents++, sessionCount, projectIds
  |     +-- New -> insert with firstSeen = lastSeen = now
  |
  +- 7. Aggregate insert (namespace: "eventName:YYYY-MM-DD")
  |     +-- DirectAggregate from @convex-dev/aggregate -- O(log n) counts
  |
  +- 8. Sharded counter increment
        +-- ShardedCounter from @convex-dev/sharded-counter -- 16 shards
```

## Child Components

| Component | Package | Purpose | Config |
|-----------|---------|---------|--------|
| aggregate | @convex-dev/aggregate | O(log n) date-range counts | Namespace: "eventName:YYYY-MM-DD" |
| shardedCounter | @convex-dev/sharded-counter | High-throughput event counting | 16 shards |
| rateLimiter | @convex-dev/rate-limiter | Per-session abuse prevention | 100/min, token bucket, burst 10 |

Mounted in `convex.config.ts`:

```typescript
const component = defineComponent("analytics");
component.use(aggregate);
component.use(shardedCounter);
component.use(rateLimiter);
```

## Session Lifecycle

- Auto-created on first event per sessionId
- seqNum derived from session.eventCount (TOCTOU-safe: session updated before event insert)
- Closed by `closeInactiveSessions` cron after 30min of no events
- Closing sets endTime and computes duration

## Cron Jobs

| Cron | Schedule | What it does |
|------|----------|-------------|
| rollup | Every 5 min | Scans last 10min of events, aggregates into daily_rollups with dimension breakdowns. Idempotent via Math.max merge (not +=). |
| closeInactiveSessions | Every 5 min | Finds sessions with no events in 30min, sets endTime + duration. |
| ttlCleanup | Daily | Deletes events older than retention_days (default 90). Emergency mode halves retention if storage >90%. Batched 500/delete, max 5000/run. |
| monitor | Weekly | Logs storage usage (events, sessions, users). Warns if count > alert_threshold. |
| rebalance | Weekly | Compares sharded counter vs actual event count per event name. Logs warning if drift >1%. |

## Daily Rollups

- Dimension breakdowns pre-computed: locale, device, country, browser, os, path, referrer, platform
- Merge strategy: `Math.max` (not `+=`) -- safe to re-run, idempotent
- Partitioned by: name + projectId + env + date

## Alias (User Merge)

1. Reassign all events from anonymousId to identifiedId (paginated 500/batch)
2. Reassign all sessions from anonymousId to identifiedId (paginated 500/batch)
3. If identifiedId user exists: merge records (min firstSeen, max lastSeen, sum counts, union projectIds), delete anonymous user record
4. If identifiedId user doesn't exist: rename anonymous user's visitorId
5. Self-alias (anonymousId === identifiedId) is a no-op

## GDPR Deletion

Cascading delete for a userId:

1. Delete all events (batched 500/delete)
2. Delete all sessions
3. Delete user record
