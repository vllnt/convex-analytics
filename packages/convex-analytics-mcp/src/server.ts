#!/usr/bin/env node
/**
 * convex-analytics-mcp — MCP server for convex-analytics
 *
 * 12 tools: 9 structured + 2 AI-powered + 1 NL router
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
  const url = new URL(`${BASE_URL}/api/analytics${path}`);
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function apiPost(path: string, body: unknown): Promise<unknown> {
  const url = `${BASE_URL}/api/analytics${path}`;
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function apiDelete(path: string, params?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${BASE_URL}/api/analytics${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    method: "DELETE",
    headers: { "x-api-key": API_KEY },
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
    name: "get_timeseries",
    description:
      "Get event counts over time. Returns daily/weekly/monthly buckets with counts and unique users.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name" },
        interval: {
          type: "string",
          enum: ["day", "week", "month"],
          default: "day",
        },
        from: { type: "string", description: "Start date (ISO)" },
        to: { type: "string", description: "End date (ISO)" },
        projectId: { type: "string" },
      },
      required: ["name"],
    },
    handler: async (args) => {
      const data = await apiGet("/timeseries", {
        name: args["name"] as string,
        interval: (args["interval"] as string) ?? "day",
        from: args["from"] ? String(new Date(args["from"] as string).getTime()) : "",
        to: args["to"] ? String(new Date(args["to"] as string).getTime()) : "",
        projectId: (args["projectId"] as string) ?? "",
      });
      return formatTable(data as Array<Record<string, unknown>>, [
        "date",
        "count",
        "uniques",
      ]);
    },
  },
  {
    name: "get_funnel",
    description:
      "Analyze conversion funnel. Shows how users progress through ordered steps (e.g., page_view → signup → purchase).",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Ordered event names (e.g., ['page_view', 'signup', 'purchase'])",
        },
        window: { type: "string", default: "7d", description: "Time window (e.g., '7d', '24h')" },
        projectId: { type: "string" },
      },
      required: ["steps"],
    },
    handler: async (args) => {
      const data = await apiGet("/funnel", {
        steps: (args["steps"] as string[]).join(","),
        window: (args["window"] as string) ?? "7d",
        projectId: (args["projectId"] as string) ?? "",
      });
      return formatTable(data as Array<Record<string, unknown>>, [
        "step",
        "count",
        "rate",
        "dropoff",
      ]);
    },
  },
  {
    name: "get_retention",
    description:
      "Cohort retention analysis. Groups users by when they first appeared, tracks return rates.",
    inputSchema: {
      type: "object",
      properties: {
        event: { type: "string", description: "Event to track retention for" },
        period: { type: "string", enum: ["day", "week", "month"], default: "week" },
        cohorts: { type: "number", default: 8 },
        projectId: { type: "string" },
      },
      required: ["event"],
    },
    handler: async (args) => {
      const data = (await apiGet("/retention", {
        event: args["event"] as string,
        period: (args["period"] as string) ?? "week",
        cohorts: String(args["cohorts"] ?? 8),
        projectId: (args["projectId"] as string) ?? "",
      })) as { cohorts: Array<Record<string, unknown>> };
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_breakdown",
    description:
      "Break down event counts by a dimension (locale, country, device, browser, os, path, referrer).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name" },
        dimension: {
          type: "string",
          enum: ["locale", "country", "device", "browser", "os", "path", "referrer", "platform"],
        },
        projectId: { type: "string" },
      },
      required: ["name", "dimension"],
    },
    handler: async (args) => {
      const data = await apiGet("/breakdown", {
        name: args["name"] as string,
        dimension: args["dimension"] as string,
        projectId: (args["projectId"] as string) ?? "",
      });
      return formatTable(data as Array<Record<string, unknown>>, [
        "value",
        "count",
        "percentage",
      ]);
    },
  },
  {
    name: "get_attribution",
    description:
      "Traffic source attribution. Shows which referrers/UTM sources drive conversions.",
    inputSchema: {
      type: "object",
      properties: {
        conversion_event: { type: "string", description: "The conversion event name" },
        projectId: { type: "string" },
      },
      required: ["conversion_event"],
    },
    handler: async (args) => {
      const data = await apiGet("/attribution", {
        event: args["conversion_event"] as string,
        projectId: (args["projectId"] as string) ?? "",
      });
      return formatTable(data as Array<Record<string, unknown>>, [
        "source",
        "conversions",
        "rate",
      ]);
    },
  },
  {
    name: "get_user_journey",
    description: "Get full event timeline and sessions for a specific user.",
    inputSchema: {
      type: "object",
      properties: {
        userId: { type: "string" },
        limit: { type: "number", default: 50 },
      },
      required: ["userId"],
    },
    handler: async (args) => {
      const data = (await apiGet("/user", {
        id: args["userId"] as string,
        limit: String(args["limit"] ?? 50),
      })) as { user: unknown; events: unknown[]; sessions: unknown[] };
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_session",
    description: "Get all events in a session, ordered by sequence number (replay).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      const data = await apiGet("/session", { id: args["sessionId"] as string });
      return JSON.stringify(data, null, 2);
    },
  },
  {
    name: "get_live",
    description: "Get the most recent events (real-time stream).",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20 },
        projectId: { type: "string" },
      },
    },
    handler: async (args) => {
      const data = await apiGet("/live", {
        limit: String(args["limit"] ?? 20),
        projectId: (args["projectId"] as string) ?? "",
      });
      return formatTable(data as Array<Record<string, unknown>>, [
        "name",
        "userId",
        "path",
        "country",
        "device",
      ]);
    },
  },
  {
    name: "compare_periods",
    description: "Compare an event's metrics between current and previous period.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name" },
        interval: { type: "string", enum: ["day", "week", "month"], default: "week" },
        projectId: { type: "string" },
      },
      required: ["name"],
    },
    handler: async (args) => {
      const now = Date.now();
      const interval = (args["interval"] as string) ?? "week";
      const periodMs =
        interval === "day" ? 86400000 : interval === "week" ? 604800000 : 2592000000;

      const current = await apiGet("/count", {
        name: args["name"] as string,
        from: String(now - periodMs),
        to: String(now),
      });
      const previous = await apiGet("/count", {
        name: args["name"] as string,
        from: String(now - 2 * periodMs),
        to: String(now - periodMs),
      });

      const c = (current as { count: number }).count;
      const p = (previous as { count: number }).count;
      const change = p > 0 ? ((c - p) / p) * 100 : c > 0 ? 100 : 0;

      return `${args["name"]} (${interval}):\n  Current: ${c}\n  Previous: ${p}\n  Change: ${change > 0 ? "+" : ""}${change.toFixed(1)}%`;
    },
  },
  {
    name: "get_stickiness",
    description: "Get DAU/MAU ratio (engagement depth) with trend over time.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
      },
    },
    handler: async (args) => {
      const data = (await apiGet("/stickiness", {
        projectId: (args["projectId"] as string) ?? "",
      })) as { ratio: number; trend: Array<Record<string, unknown>> };
      return `Stickiness (DAU/MAU): ${(data.ratio * 100).toFixed(1)}%\n\n${formatTable(data.trend, ["date", "dau", "mau", "ratio"])}`;
    },
  },
  {
    name: "detect_anomalies",
    description:
      "Detect statistical anomalies in event counts. Flags days where counts deviate significantly from the mean.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Event name (omit for all events)" },
        threshold: { type: "number", default: 2, description: "Z-score threshold (default 2)" },
        projectId: { type: "string" },
      },
    },
    handler: async (args) => {
      const threshold = (args["threshold"] as number) ?? 2;
      const data = (await apiGet("/timeseries", {
        name: (args["name"] as string) ?? "",
        interval: "day",
        projectId: (args["projectId"] as string) ?? "",
      })) as Array<{ date: string; count: number }>;

      if (data.length < 3) return "Not enough data for anomaly detection (need 3+ days)";

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
          date: a.date,
          count: a.count,
          zscore: a.zscore.toFixed(2),
          type: a.zscore > 0 ? "SPIKE" : "DROP",
        })),
        ["date", "count", "zscore", "type"],
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
      },
      required: ["question"],
    },
    handler: async (args) => {
      const q = (args["question"] as string).toLowerCase();

      // Route NL to structured queries
      if (q.includes("funnel") || q.includes("conversion")) {
        const events = q.match(/(\w+)\s*[→>]\s*(\w+)/g);
        if (events) {
          const steps = events[0]!.split(/[→>]/).map((s) => s.trim());
          return (tools.find((t) => t.name === "get_funnel")!).handler({ steps });
        }
        return "Please specify funnel steps like: page_view → signup → purchase";
      }

      if (q.includes("retention") || q.includes("retain")) {
        const eventMatch = q.match(/retention\s+(?:for\s+)?(\w+)/);
        const event = eventMatch?.[1] ?? "page_view";
        return (tools.find((t) => t.name === "get_retention")!).handler({ event });
      }

      if (q.includes("trending") || q.includes("trend") || q.includes("over time")) {
        const nameMatch = q.match(/(?:for|of|on)\s+(\w+)/);
        const name = nameMatch?.[1] ?? "page_view";
        return (tools.find((t) => t.name === "get_timeseries")!).handler({ name });
      }

      if (q.includes("breakdown") || q.includes("by country") || q.includes("by device") || q.includes("by locale")) {
        const dimMatch = q.match(/by\s+(\w+)/);
        const dimension = dimMatch?.[1] ?? "country";
        const nameMatch = q.match(/(?:for|of)\s+(\w+)/);
        const name = nameMatch?.[1] ?? "page_view";
        return (tools.find((t) => t.name === "get_breakdown")!).handler({ name, dimension });
      }

      if (q.includes("live") || q.includes("real-time") || q.includes("recent")) {
        return (tools.find((t) => t.name === "get_live")!).handler({ limit: 20 });
      }

      if (q.includes("anomal") || q.includes("unusual") || q.includes("spike") || q.includes("drop")) {
        return (tools.find((t) => t.name === "detect_anomalies")!).handler({});
      }

      if (q.includes("stickiness") || q.includes("dau") || q.includes("engagement")) {
        return (tools.find((t) => t.name === "get_stickiness")!).handler({});
      }

      if (q.includes("compare") || q.includes("vs") || q.includes("versus")) {
        const nameMatch = q.match(/(?:for|of|on)\s+(\w+)/);
        const name = nameMatch?.[1] ?? "page_view";
        return (tools.find((t) => t.name === "compare_periods")!).handler({ name });
      }

      // Default: summary
      const summary = await apiGet("/summary");
      return `Summary:\n${formatTable(summary as Array<Record<string, unknown>>, ["name", "count"])}`;
    },
  },
];

// ─── MCP Server (stdio transport) ─────────────────────────────────────────

const SERVER_INFO = {
  name: "convex-analytics-mcp",
  version: "0.1.0",
  description: "Analytics MCP server for convex-analytics Convex Component",
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

// Simple stdio JSON-RPC transport
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
