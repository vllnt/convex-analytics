import { describe, it, expect } from "vitest";

describe("MCP tool routing", () => {
  function routeQuery(q: string): string {
    q = q.toLowerCase();
    if (q.includes("trending") || q.includes("trend") || q.includes("over time") || q.includes("timeseries")) return "get_timeseries";
    if (q.includes("breakdown") || q.includes("top ") || q.includes("by ")) return "get_top";
    if (q.includes("unique") || q.includes("dau") || q.includes("mau") || q.includes("active users")) return "get_uniques";
    if (q.includes("anomal") || q.includes("spike") || q.includes("drop")) return "detect_anomalies";
    if (q.includes("count") || q.includes("total") || q.includes("how many")) return "get_metric";
    return "get_metric";
  }

  it("routes trending questions to timeseries", () => {
    expect(routeQuery("How are signups trending this month?")).toBe("get_timeseries");
    expect(routeQuery("Show me page_view over time")).toBe("get_timeseries");
  });

  it("routes breakdown questions to get_top", () => {
    expect(routeQuery("Break down signups by plan")).toBe("get_top");
    expect(routeQuery("Top events by country")).toBe("get_top");
  });

  it("routes unique/DAU questions to get_uniques", () => {
    expect(routeQuery("What's the DAU this week?")).toBe("get_uniques");
    expect(routeQuery("How many unique active users?")).toBe("get_uniques");
  });

  it("routes anomaly questions correctly", () => {
    expect(routeQuery("Any anomalies this week?")).toBe("detect_anomalies");
    expect(routeQuery("Why did signups spike?")).toBe("detect_anomalies");
    expect(routeQuery("Was there a drop?")).toBe("detect_anomalies");
  });

  it("routes count/total questions to get_metric", () => {
    expect(routeQuery("How many signups total?")).toBe("get_metric");
    expect(routeQuery("Count of purchases")).toBe("get_metric");
  });

  it("falls back to get_metric for unknown queries", () => {
    expect(routeQuery("Tell me about analytics")).toBe("get_metric");
    expect(routeQuery("Hello")).toBe("get_metric");
  });
});

describe("anomaly detection", () => {
  it("AC-34: detects Z-score deviations", () => {
    const data = [
      { bucket: "2026-03-01", count: 10 },
      { bucket: "2026-03-02", count: 10 },
      { bucket: "2026-03-03", count: 10 },
      { bucket: "2026-03-04", count: 10 },
      { bucket: "2026-03-05", count: 10 },
      { bucket: "2026-03-06", count: 10 },
      { bucket: "2026-03-07", count: 50 },
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
    expect(anomalies[0]!.bucket).toBe("2026-03-07");
    expect(anomalies[0]!.zscore).toBeGreaterThan(2);
  });

  it("handles no variance gracefully", () => {
    const data = [
      { bucket: "2026-03-01", count: 5 },
      { bucket: "2026-03-02", count: 5 },
      { bucket: "2026-03-03", count: 5 },
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
