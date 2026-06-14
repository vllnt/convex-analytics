#!/usr/bin/env node
/**
 * convex-analytics-mcp — MCP server for convex-analytics
 *
 * 7 tools: 5 structured + 1 computed anomaly detector + 1 NL router
 *
 * Usage:
 *   claude mcp add convex-analytics-mcp \
 *     --env CONVEX_URL=https://your-deployment.convex.cloud \
 *     --env ANALYTICS_API_KEY=your-key
 */

import { createBackendLogger } from "@vllnt/logger";

const logger = createBackendLogger("convex-analytics-mcp");

const _CONVEX_URL = process.env["CONVEX_URL"];
const _API_KEY = process.env["ANALYTICS_API_KEY"];

if (!_CONVEX_URL) {
  logger.error("missing-env", { variable: "CONVEX_URL" });
  process.exit(1);
}
if (!_API_KEY) {
  logger.error("missing-env", { variable: "ANALYTICS_API_KEY" });
  process.exit(1);
}

const CONVEX_URL: string = _CONVEX_URL;
const API_KEY: string = _API_KEY;
const BASE_URL = CONVEX_URL.replace(/\.convex\.cloud$/, ".convex.site");

async function apiGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: { "x-api-key": API_KEY },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function apiPost(path: string, body: unknown): Promise<unknown> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

function formatTable(data: Array<Record<string, unknown>>, columns?: string[]): string {
  if (data.length === 0) return "No data";
  const cols = columns ?? Object.keys(data[0]!);
  const header = cols.join(" | ");
  const separator = cols.map(() => "---").join(" | ");
  const rows = data.map((row) =>
    cols.map((c) => String(row[c] ?? "")).join(" | "),
  );
  return [header, separator, ...rows].join("\n");
}

// ─── Tool Definitions ─────────────────────────────────────────────────────

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

const tools: Tool[] = [
  {
    name: "track",
    description:
      "Ingest an analytics event. Rollup-on-write: increments counters and dimension rollups immediately.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name (e.g. 'signup', 'page_view')" },
        subjectRef: { type: "string", description: "Opaque subject identifier (user id, device id, etc.)" },
        sessionRef: { type: "string", description: "Opaque session identifier" },
        props: {
          type: "object",
          description: "Arbitrary key/value props (string/number/boolean/null values)",
          additionalProperties: true,
        },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "Prop keys to roll up on (must match the component mount config)",
        },
        granularities: {
          type: "array",
          items: { type: "string", enum: ["hour", "day"] },
          description: "Rollup time buckets. Defaults to [\"day\"]",
        },
        scope: { type: "string", description: "Scope/partition key. Defaults to \"default\"" },
        dedupeKey: { type: "string", description: "Optional idempotency key" },
      },
      required: ["name", "dimensions"],
    },
    handler: async (args) => {
      const result = await apiPost("/track", {
        name: args["name"],
        subjectRef: args["subjectRef"],
        sessionRef: args["sessionRef"],
        props: args["props"],
        dimensions: args["dimensions"] ?? [],
        granularities: args["granularities"] ?? ["day"],
        scope: args["scope"] ?? "default",
        dedupeKey: args["dedupeKey"],
      });
      return JSON.stringify(result);
    },
  },
  {
    name: "get_metric",
    description:
      "Get the total event count for an event name over a time range, optionally filtered by a dimension value.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name" },
        from: { type: "string", description: "Start timestamp (ms since epoch)" },
        to: { type: "string", description: "End timestamp (ms since epoch)" },
        dim: { type: "string", description: "Dimension key to filter by" },
        val: { type: "string", description: "Dimension value to filter by (requires dim)" },
        scope: { type: "string" },
      },
      required: ["name"],
    },
    handler: async (args) => {
      const data = await apiGet("/metric", {
        name: args["name"] as string,
        from: args["from"] ? String(args["from"]) : "",
        to: args["to"] ? String(args["to"]) : "",
        dim: (args["dim"] as string) ?? "",
        val: (args["val"] as string) ?? "",
        scope: (args["scope"] as string) ?? "",
      });
      const result = data as { name: string; count: number };
      return `${result.name}: ${result.count} events`;
    },
  },
  {
    name: "get_top",
    description:
      "Get the top values of a dimension for an event (generic breakdown). Use for any dimension: plan, country, device, path, source, etc.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name" },
        dimension: { type: "string", description: "Dimension key to break down by (e.g. 'plan', 'country', 'device')" },
        limit: { type: "number", default: 10 },
        from: { type: "string", description: "Start timestamp (ms since epoch)" },
        to: { type: "string", description: "End timestamp (ms since epoch)" },
        scope: { type: "string" },
      },
      required: ["name", "dimension"],
    },
    handler: async (args) => {
      const data = await apiGet("/top", {
        name: args["name"] as string,
        dimension: args["dimension"] as string,
        limit: args["limit"] ? String(args["limit"]) : "10",
        from: args["from"] ? String(args["from"]) : "",
        to: args["to"] ? String(args["to"]) : "",
        scope: (args["scope"] as string) ?? "",
      });
      return formatTable(data as Array<Record<string, unknown>>, ["value", "count"]);
    },
  },
  {
    name: "get_timeseries",
    description:
      "Get event counts bucketed over time (hourly or daily). Returns time-series data for trend analysis.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name" },
        granularity: {
          type: "string",
          enum: ["hour", "day"],
          default: "day",
        },
        from: { type: "string", description: "Start timestamp (ms since epoch)" },
        to: { type: "string", description: "End timestamp (ms since epoch)" },
        dim: { type: "string", description: "Filter dimension key" },
        val: { type: "string", description: "Filter dimension value" },
        scope: { type: "string" },
      },
      required: ["name"],
    },
    handler: async (args) => {
      const data = await apiGet("/timeseries", {
        name: args["name"] as string,
        granularity: (args["granularity"] as string) ?? "day",
        from: args["from"] ? String(args["from"]) : "",
        to: args["to"] ? String(args["to"]) : "",
        dim: (args["dim"] as string) ?? "",
        val: (args["val"] as string) ?? "",
        scope: (args["scope"] as string) ?? "",
      });
      return formatTable(data as Array<Record<string, unknown>>, ["bucket", "count"]);
    },
  },
  {
    name: "get_uniques",
    description:
      "Get unique active subjects (DAU/WAU/MAU) over a time range, bucketed by hour or day.",
    inputSchema: {
      type: "object",
      properties: {
        granularity: {
          type: "string",
          enum: ["hour", "day"],
          default: "day",
        },
        from: { type: "string", description: "Start timestamp (ms since epoch)" },
        to: { type: "string", description: "End timestamp (ms since epoch)" },
        scope: { type: "string" },
      },
    },
    handler: async (args) => {
      const data = await apiGet("/uniques", {
        granularity: (args["granularity"] as string) ?? "day",
        from: args["from"] ? String(args["from"]) : "",
        to: args["to"] ? String(args["to"]) : "",
        scope: (args["scope"] as string) ?? "",
      });
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "detect_anomalies",
    description:
      "Detect statistical anomalies in event counts. Fetches timeseries and flags buckets that deviate significantly from the mean (Z-score).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name" },
        granularity: { type: "string", enum: ["hour", "day"], default: "day" },
        from: { type: "string", description: "Start timestamp (ms since epoch)" },
        to: { type: "string", description: "End timestamp (ms since epoch)" },
        threshold: { type: "number", default: 2, description: "Z-score threshold (default 2)" },
        scope: { type: "string" },
      },
      required: ["name"],
    },
    handler: async (args) => {
      const threshold = (args["threshold"] as number) ?? 2;
      const data = (await apiGet("/timeseries", {
        name: args["name"] as string,
        granularity: (args["granularity"] as string) ?? "day",
        from: args["from"] ? String(args["from"]) : "",
        to: args["to"] ? String(args["to"]) : "",
        scope: (args["scope"] as string) ?? "",
      })) as Array<{ bucket: string; count: number }>;

      if (data.length < 3) return "Not enough data for anomaly detection (need 3+ buckets)";

      const counts = data.map((d) => d.count);
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      const std = Math.sqrt(
        counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length,
      );

      if (std === 0) return "No variance in data — all counts identical";

      const anomalies = data
        .map((d) => ({ ...d, zscore: (d.count - mean) / std }))
        .filter((d) => Math.abs(d.zscore) >= threshold);

      if (anomalies.length === 0) return `No anomalies detected (threshold: ${threshold}σ, mean: ${mean.toFixed(0)})`;

      return `Anomalies (threshold: ${threshold}σ, mean: ${mean.toFixed(0)}, std: ${std.toFixed(1)}):\n\n${formatTable(
        anomalies.map((a) => ({
          bucket: a.bucket,
          count: a.count,
          zscore: a.zscore.toFixed(2),
          type: a.zscore > 0 ? "SPIKE" : "DROP",
        })),
        ["bucket", "count", "zscore", "type"],
      )}`;
    },
  },
  {
    name: "query_analytics",
    description:
      "Natural language analytics query. Describe what you want to know and this tool routes to the correct structured query.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", description: "Your analytics question in plain English" },
        name: { type: "string", description: "Event name hint (optional)" },
        dimension: { type: "string", description: "Dimension hint for breakdown queries (optional)" },
        scope: { type: "string" },
      },
      required: ["question"],
    },
    handler: async (args) => {
      const q = (args["question"] as string).toLowerCase();
      const nameHint = (args["name"] as string | undefined) ?? extractName(q);
      const dimHint = (args["dimension"] as string | undefined) ?? extractDimension(q);
      const scope = (args["scope"] as string) ?? "";

      if (q.includes("trending") || q.includes("trend") || q.includes("over time") || q.includes("timeseries")) {
        return tools.find((t) => t.name === "get_timeseries")!.handler({ name: nameHint, scope });
      }

      if (q.includes("breakdown") || q.includes("top ") || q.includes("by ")) {
        return tools.find((t) => t.name === "get_top")!.handler({ name: nameHint, dimension: dimHint, scope });
      }

      if (q.includes("unique") || q.includes("dau") || q.includes("mau") || q.includes("active users")) {
        return tools.find((t) => t.name === "get_uniques")!.handler({ scope });
      }

      if (q.includes("anomal") || q.includes("unusual") || q.includes("spike") || q.includes("drop")) {
        return tools.find((t) => t.name === "detect_anomalies")!.handler({ name: nameHint, scope });
      }

      if (q.includes("count") || q.includes("total") || q.includes("how many")) {
        return tools.find((t) => t.name === "get_metric")!.handler({ name: nameHint, scope });
      }

      return tools.find((t) => t.name === "get_metric")!.handler({ name: nameHint, scope });
    },
  },
];

function extractName(q: string): string {
  const m = q.match(/(?:for|of|on|event)\s+["']?(\w+)["']?/);
  return m?.[1] ?? "page_view";
}

function extractDimension(q: string): string {
  const m = q.match(/\bby\s+(\w+)/);
  return m?.[1] ?? "value";
}

// ─── MCP Server (stdio transport) ─────────────────────────────────────────

const SERVER_INFO = {
  name: "convex-analytics-mcp",
  version: "0.2.0",
  description: "Analytics MCP server for convex-analytics Convex Component (generic API)",
};

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
    };
  }
  try {
    const result = await tool.handler(args);
    return { content: [{ type: "text", text: result }] };
  } catch (err) {
    return {
      content: [
        { type: "text", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ],
    };
  }
}

async function main(): Promise<void> {
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin });

  for await (const line of rl) {
    try {
      const msg = JSON.parse(line);

      if (msg.method === "initialize") {
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: SERVER_INFO,
            capabilities: {
              tools: { listChanged: false },
            },
          },
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      } else if (msg.method === "tools/list") {
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      } else if (msg.method === "tools/call") {
        const result = await handleToolCall(
          msg.params.name,
          msg.params.arguments ?? {},
        );
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          result,
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      } else if (msg.method === "notifications/initialized") {
        // Client acknowledged init — no response needed
      } else {
        const response = {
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: `Method not found: ${msg.method}` },
        };
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch {
      // Invalid JSON — skip
    }
  }
}

main().catch((err: unknown) => logger.error("fatal", { error: err instanceof Error ? err.message : String(err) }));
