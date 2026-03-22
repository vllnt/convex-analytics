# MCP Tools

## Setup

```bash
claude mcp add convex-analytics-mcp \
  --env CONVEX_URL=https://your-deployment.convex.cloud \
  --env ANALYTICS_API_KEY=your-key
```

Requires: CONVEX_URL and ANALYTICS_API_KEY environment variables.

## Tools (12)

### Structured Query Tools (9)

**get_timeseries** -- Event counts over time
- Input: `name` (required), `interval` (day|week|month), `from`, `to`, `projectId`
- Output: Table of date, count, uniques
- Example: "Show me page_view trends this month"

**get_funnel** -- Conversion funnel analysis
- Input: `steps` (required, string array), `window` (default "7d"), `projectId`
- Output: Table of step, count, rate, dropoff
- Example: "What's the conversion from page_view -> signup -> purchase?"

**get_retention** -- Cohort retention analysis
- Input: `event` (required), `period` (day|week|month), `cohorts` (max 12), `projectId`
- Output: JSON with cohort periods and retention arrays
- Example: "Show retention for signup events by week"

**get_breakdown** -- Dimension breakdown
- Input: `name` (required), `dimension` (required: locale|country|device|browser|os|path|referrer|platform), `projectId`
- Output: Table of value, count, percentage
- Example: "Break down page_view by country"

**get_attribution** -- Traffic source attribution
- Input: `conversion_event` (required), `projectId`
- Output: Table of source, conversions, rate
- Example: "Which sources drive the most signups?"

**get_user_journey** -- Full user timeline
- Input: `userId` (required), `limit`
- Output: JSON with user profile, events, sessions
- Example: "Show me user abc123's journey"

**get_session** -- Session replay (ordered events)
- Input: `sessionId` (required)
- Output: JSON with session metadata and events sorted by seqNum

**get_live** -- Real-time event stream
- Input: `limit` (default 20), `projectId`
- Output: Table of recent events (name, userId, path, country, device)

**compare_periods** -- Period-over-period comparison
- Input: `name` (required), `interval` (day|week|month), `projectId`
- Output: Current count, previous count, % change

### AI-Powered Tools (2)

**detect_anomalies** -- Statistical anomaly detection
- Input: `name` (optional, all events if omitted), `threshold` (z-score, default 2), `projectId`
- Uses z-score analysis on daily timeseries
- Flags days where counts deviate >threshold standard deviations from mean
- Output: Table of anomalous dates with count, zscore, type (SPIKE|DROP)

**get_stickiness** -- DAU/MAU engagement depth
- Input: `projectId`
- Output: Overall ratio + daily trend table

### Natural Language Router (1)

**query_analytics** -- Route natural language to structured queries
- Input: `question` (required, plain English)
- Keyword routing table:
  - "funnel", "conversion" -> get_funnel
  - "retention", "retain" -> get_retention
  - "trending", "trend", "over time" -> get_timeseries
  - "breakdown", "by country/device/locale" -> get_breakdown
  - "live", "real-time", "recent" -> get_live
  - "anomal", "unusual", "spike", "drop" -> detect_anomalies
  - "stickiness", "dau", "engagement" -> get_stickiness
  - "compare", "vs", "versus" -> compare_periods
  - Default -> summary
