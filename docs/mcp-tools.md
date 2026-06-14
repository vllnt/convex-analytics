# MCP Tools

The `convex-analytics-mcp` server exposes the generic analytics surface as MCP tools over the
component's REST endpoints.

## Setup

```bash
claude mcp add convex-analytics-mcp \
  --env CONVEX_URL=https://your-deployment.convex.cloud \
  --env ANALYTICS_API_KEY=your-key
```

Requires `CONVEX_URL` and `ANALYTICS_API_KEY`. The server targets the `.convex.site` REST
host derived from `CONVEX_URL`.

## Tools (7)

### track

Ingest an event (rollup-on-write).

- Input: `name` (required), `dimensions` (required, string[]), `subjectRef`, `sessionRef`, `props`, `granularities`, `scope`, `dedupeKey`.
- Output: the `track` result (`tracked` / `dropped` / `duplicate`).

### get_metric

Total count for an event over a range, optionally filtered by a dimension value.

- Input: `name` (required), `from`, `to`, `dim`, `val`, `scope`.
- Output: `<name>: <count> events`.

### get_top

Top values of any dimension (generic breakdown — `plan`, `country`, `device`, `path`, …).

- Input: `name` (required), `dimension` (required), `limit`, `from`, `to`, `scope`.
- Output: table of `value | count`.

### get_timeseries

Event counts bucketed over time.

- Input: `name` (required), `granularity` (`hour` \| `day`), `from`, `to`, `dim`, `val`, `scope`.
- Output: table of `bucket | count`.

### get_uniques

DAU / WAU / MAU over a range.

- Input: `granularity` (`hour` \| `day`), `from`, `to`, `scope`.
- Output: JSON `{ dau, wau, mau, trend }`.

### detect_anomalies

Statistical anomaly detection over a timeseries (Z-score). Flags buckets that deviate from
the mean.

- Input: `name` (required), `granularity`, `from`, `to`, `threshold` (default 2), `scope`.
- Output: table of anomalous buckets with `count`, `zscore`, `type` (SPIKE / DROP).

### query_analytics

Natural-language router — describe what you want and it dispatches to the right structured
tool.

- Input: `question` (required), `name`, `dimension`, `scope`.
- Routes on keywords: trend/over-time → `get_timeseries`; breakdown/top/by → `get_top`;
  unique/dau/mau → `get_uniques`; anomaly/spike/drop → `detect_anomalies`;
  count/total/how-many → `get_metric` (default).
