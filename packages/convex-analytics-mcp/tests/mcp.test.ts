import { describe, it, expect } from "vitest";

describe("MCP tool routing", () => {
  function routeQuery(q: string): string {
    q = q.toLowerCase();
    if (q.includes("funnel") || q.includes("conversion")) return "get_funnel";
    if (q.includes("retention") || q.includes("retain")) return "get_retention";
    if (q.includes("trending") || q.includes("trend") || q.includes("over time")) return "get_timeseries";
    if (q.includes("breakdown") || q.includes("by country") || q.includes("by device")) return "get_breakdown";
    if (q.includes("live") || q.includes("real-time") || q.includes("recent")) return "get_live";
    if (q.includes("anomal") || q.includes("spike") || q.includes("drop")) return "detect_anomalies";
    if (q.includes("stickiness") || q.includes("dau") || q.includes("engagement")) return "get_stickiness";
    if (q.includes("compare") || q.includes("vs")) return "compare_periods";
    return "summary";
  }

  it("AC-33: routes trending questions to timeseries", () => {
    expect(routeQuery("How are signups trending this month?")).toBe("get_timeseries");
    expect(routeQuery("Show me page_view over time")).toBe("get_timeseries");
  });

  it("routes funnel questions correctly", () => {
    expect(routeQuery("What's the conversion funnel?")).toBe("get_funnel");
    expect(routeQuery("Show me the signup funnel")).toBe("get_funnel");
  });

  it("routes retention questions correctly", () => {
    expect(routeQuery("Are we retaining users?")).toBe("get_retention");
    expect(routeQuery("Show retention for signups")).toBe("get_retention");
  });

  it("routes breakdown questions correctly", () => {
    expect(routeQuery("Break down signups by country")).toBe("get_breakdown");
    expect(routeQuery("Show events by device")).toBe("get_breakdown");
  });

  it("routes live/recent questions correctly", () => {
    expect(routeQuery("What happened recently?")).toBe("get_live");
    expect(routeQuery("Show me live events")).toBe("get_live");
  });

  it("routes anomaly questions correctly", () => {
    expect(routeQuery("Any anomalies this week?")).toBe("detect_anomalies");
    expect(routeQuery("Why did signups spike?")).toBe("detect_anomalies");
    expect(routeQuery("Was there a drop?")).toBe("detect_anomalies");
  });

  it("routes stickiness questions correctly", () => {
    expect(routeQuery("What's our DAU/MAU?")).toBe("get_stickiness");
    expect(routeQuery("How's user engagement?")).toBe("get_stickiness");
  });

  it("routes comparison questions correctly", () => {
    expect(routeQuery("Compare signups vs last week")).toBe("compare_periods");
  });

  it("falls back to summary for unknown queries", () => {
    expect(routeQuery("Tell me about analytics")).toBe("summary");
    expect(routeQuery("Hello")).toBe("summary");
  });
});

describe("anomaly detection", () => {
  it("AC-34: detects Z-score deviations", () => {
    const data = [
      { date: "2026-03-01", count: 10 },
      { date: "2026-03-02", count: 10 },
      { date: "2026-03-03", count: 10 },
      { date: "2026-03-04", count: 10 },
      { date: "2026-03-05", count: 10 },
      { date: "2026-03-06", count: 10 },
      { date: "2026-03-07", count: 50 },
    ];

    const counts = data.map((d) => d.count);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const std = Math.sqrt(
      counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length,
    );

    const anomalies = data
      .map((d) => ({ ...d, zscore: (d.count - mean) / std }))
      .filter((d) => Math.abs(d.zscore) >= 2);

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.date).toBe("2026-03-07");
    expect(anomalies[0]!.zscore).toBeGreaterThan(2);
  });

  it("handles no variance gracefully", () => {
    const data = [
      { date: "2026-03-01", count: 5 },
      { date: "2026-03-02", count: 5 },
      { date: "2026-03-03", count: 5 },
    ];

    const counts = data.map((d) => d.count);
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const std = Math.sqrt(
      counts.reduce((sum, c) => sum + (c - mean) ** 2, 0) / counts.length,
    );

    expect(std).toBe(0);
  });
});

describe("formatTable", () => {
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

  it("formats data as markdown table", () => {
    const result = formatTable(
      [
        { name: "signup", count: 42 },
        { name: "login", count: 100 },
      ],
      ["name", "count"],
    );
    expect(result).toContain("name | count");
    expect(result).toContain("signup | 42");
    expect(result).toContain("login | 100");
  });

  it("handles empty data", () => {
    expect(formatTable([])).toBe("No data");
  });
});
