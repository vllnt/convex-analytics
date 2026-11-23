/// <reference types="vite/client" />
import { describe, it, expect, vi, afterEach } from "vitest";
import { DirectAggregate } from "@convex-dev/aggregate";
import { api } from "../src/component/_generated/api.js";
import schema from "../src/component/schema.js";
import { initConvexTest } from "./test-helpers.js";

const DAY = Date.UTC(2026, 0, 15, 10, 0, 0);

afterEach(() => {
  vi.restoreAllMocks();
});

type Exported = { tables: Array<{ tableName: string; indexes: Array<{ indexDescriptor: string; fields: string[] }> }> };

function indexesOf(table: string): string[] {
  const exported = JSON.parse((schema as unknown as { export(): string }).export()) as Exported;
  return exported.tables
    .find((t) => t.tableName === table)!
    .indexes.map((index) => index.indexDescriptor)
    .sort();
}

describe("write path cost", () => {
  it("track writes no unread aggregate entry (nothing queries it)", async () => {
    const insert = vi.spyOn(DirectAggregate.prototype, "insert");
    const t = initConvexTest();
    await t.mutation(api.mutations.track, {
      scope: "s", name: "e", ts: DAY, dimensions: [], granularities: ["day"],
    });
    expect(insert).not.toHaveBeenCalled();
    expect(await t.query(api.queries.metric, { scope: "s", name: "e" })).toBe(1);
  });

  it("keeps only the indexes a query reads", () => {
    expect(indexesOf("events")).toEqual(["by_dedupe", "by_scope_name_ts", "by_scope_ts"]);
    expect(indexesOf("sessions")).toEqual(["by_scope_endTs_lastTs", "by_scope_session"]);
    expect(indexesOf("rollups")).toEqual([
      "by_scope_name_gran_bucket_dim",
      "by_scope_name_gran_dim_val_bucket",
    ]);
  });

  it("metric and timeseries read one series among many dimension values", async () => {
    const t = initConvexTest();
    for (const plan of ["free", "pro", "pro", "team"]) {
      await t.mutation(api.mutations.track, {
        scope: "s", name: "e", ts: DAY, props: { plan, region: "eu" },
        dimensions: ["plan", "region"], granularities: ["day"],
      });
    }
    const range = { from: DAY - 86400000, to: DAY + 86400000 };
    expect(
      await t.query(api.queries.metric, { scope: "s", name: "e", range, where: { dim: "plan", val: "pro" } }),
    ).toBe(2);
    expect(await t.query(api.queries.metric, { scope: "s", name: "e", range })).toBe(4);
    expect(
      await t.query(api.queries.timeseries, {
        scope: "s", name: "e", granularity: "day", range, where: { dim: "region", val: "eu" },
      }),
    ).toEqual([{ bucket: Date.UTC(2026, 0, 15), count: 4 }]);
  });
});
