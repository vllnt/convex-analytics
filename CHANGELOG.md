# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-21

### Added

- **Events**: Custom event tracking with typed properties, geo-detection, UTM parameters
- **Sessions**: Auto-created on first event, 30min inactivity close, entry/exit paths
- **Users**: Anonymous identity with `identify()` traits and `alias()` merge
- **Funnels**: Ordered step conversion analysis with configurable time windows
- **Retention**: Cohort-by-firstSeen with return rates per day/week/month
- **Time-series**: Daily/weekly/monthly aggregation from pre-computed rollups
- **Breakdowns**: By locale, country, device, browser, OS, path, referrer, platform
- **Attribution**: Traffic source to conversion analysis
- **Lifecycle**: New / returning / dormant / resurrected user classification
- **Stickiness**: DAU/MAU engagement ratio with trend
- **REST API**: 24 endpoints with API key auth and timing-safe comparison
- **MCP Server**: 12 tools for AI-native analytics (Claude Code, etc.)
- **Multi-product**: `projectId` + `env` + `platform` scoping across all queries
- **Crons**: Rollup aggregation, session closer, TTL cleanup, storage monitor, counter rebalance
- **Client SDK**: `ConvexAnalytics<T>` with generic type safety for event names and properties
- **Testing**: `@vllnt/convex-analytics/test` export for convex-test integration
- **Property schemas**: Declarative property validation with silent filtering
- **Sharded counter**: 16-shard high-throughput event counting
- **Rate limiter**: Token bucket (100/min per session) with silent drop
- **GDPR deletion**: Cascading delete of user events, sessions, and profile
