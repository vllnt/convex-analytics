/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { api } from "../src/component/_generated/api.js";
import { AnalyticsClient } from "../src/client/index.js";
import { initConvexTest } from "./test-helpers.js";

/**
 * The stranger test: two genuinely-different domains (a game backend and a SaaS
 * backend) drive the SAME component through `AnalyticsClient` with only config
 * differing — no domain assumption lives in the component. Also proves scope
 * isolation: each domain's `scope` partition never sees the other's events.
 */

const D = (day: number, hour = 10, min = 0) => Date.UTC(2026, 0, day, hour, min, 0);

describe("stranger test — a game backend (anthm-fr-shaped)", () => {
  type GameProps = { puzzleId: string; difficulty: string; attempts: number };

  it("tracks rounds, a per-attempt distribution, a minute live window, and idempotent outcomes", async () => {
    const t = initConvexTest();
    const game = new AnalyticsClient<GameProps>(api, {
      scope: "game",
      dimensions: ["puzzleId", "difficulty"],
      granularities: ["minute", "day"],
    });

    await t.run(async (ctx) => {
      await game.track(ctx, "round_played", {
        subjectRef: "p1",
        props: { puzzleId: "2026-06-15", difficulty: "hard", attempts: 2 },
        ts: D(15, 10, 0),
      });
      await game.track(ctx, "round_played", {
        subjectRef: "p2",
        props: { puzzleId: "2026-06-15", difficulty: "easy", attempts: 1 },
        ts: D(15, 10, 0),
      });
      await game.track(ctx, "round_played", {
        subjectRef: "p3",
        props: { puzzleId: "2026-06-15", difficulty: "hard", attempts: 5 },
        ts: D(15, 10, 1),
      });
    });

    // Histogram over a numeric measure (attempts 1..3 + overflow).
    const dist = await t.run(async (ctx) =>
      game.distribution(ctx, "round_played", "attempts", { buckets: [1, 2, 3] }),
    );
    expect(dist.bins).toEqual([
      { upper: 1, count: 1 },
      { upper: 2, count: 1 },
      { upper: 3, count: 0 },
    ]);
    expect(dist.overflow).toBe(1); // attempts=5
    expect(dist.count).toBe(3);
    expect(dist.sum).toBe(8);

    // The daily puzzle is a host dimension value — never a component-owned id.
    const byPuzzle = await t.run(async (ctx) => game.top(ctx, "round_played", "puzzleId"));
    expect(byPuzzle).toEqual([{ value: "2026-06-15", count: 3 }]);

    // Minute-resolution live window.
    const live = await t.run(async (ctx) =>
      game.timeseries(ctx, "round_played", {
        granularity: "minute",
        range: { from: D(15, 10, 0), to: D(15, 10, 5) },
      }),
    );
    expect(live).toEqual([
      { bucket: D(15, 10, 0), count: 2 },
      { bucket: D(15, 10, 1), count: 1 },
    ]);

    // Once-per-outcome: a refreshed/retried solve counts once.
    const first = await t.run(async (ctx) =>
      game.track(ctx, "solved", { subjectRef: "p1", dedupeKey: "2026-06-15:p1", ts: D(15) }),
    );
    const retry = await t.run(async (ctx) =>
      game.track(ctx, "solved", { subjectRef: "p1", dedupeKey: "2026-06-15:p1", ts: D(15) }),
    );
    expect(first).toBe("tracked");
    expect(retry).toBe("duplicate");
    expect(await t.run(async (ctx) => game.metric(ctx, "solved"))).toBe(1);
  });
});

describe("stranger test — a SaaS backend (vllnt-shaped)", () => {
  type SaasProps = { plan: string; source: string; revenue: number };

  it("tracks signups, breaks down by plan, and distributes a revenue measure", async () => {
    const t = initConvexTest();
    const saas = new AnalyticsClient<SaasProps>(api, {
      scope: "saas",
      dimensions: ["plan", "source"],
      granularities: ["day"],
    });

    await t.run(async (ctx) => {
      await saas.track(ctx, "signup", {
        subjectRef: "acct1",
        props: { plan: "pro", source: "ads", revenue: 100 },
        ts: D(1),
      });
      await saas.track(ctx, "signup", {
        subjectRef: "acct2",
        props: { plan: "free", source: "organic", revenue: 0 },
        ts: D(1),
      });
    });

    expect(await t.run(async (ctx) => saas.metric(ctx, "signup"))).toBe(2);

    const byPlan = await t.run(async (ctx) => saas.top(ctx, "signup", "plan"));
    expect(byPlan).toHaveLength(2);
    expect(byPlan.map((r) => r.value).sort()).toEqual(["free", "pro"]);

    const revenue = await t.run(async (ctx) =>
      saas.distribution(ctx, "signup", "revenue", { buckets: [50, 200] }),
    );
    expect(revenue.bins).toEqual([
      { upper: 50, count: 1 }, // revenue 0
      { upper: 200, count: 1 }, // revenue 100
    ]);
    expect(revenue.sum).toBe(100);
  });
});

describe("stranger test — scope isolation across domains", () => {
  it("one domain's scope never sees another domain's events", async () => {
    const t = initConvexTest();
    const game = new AnalyticsClient(api, { scope: "game" });
    const saas = new AnalyticsClient(api, { scope: "saas" });

    await t.run(async (ctx) => {
      await game.track(ctx, "round_played", { subjectRef: "p1", ts: D(1) });
      await saas.track(ctx, "signup", { subjectRef: "acct1", ts: D(1) });
    });

    expect(await t.run(async (ctx) => game.metric(ctx, "round_played"))).toBe(1);
    expect(await t.run(async (ctx) => game.metric(ctx, "signup"))).toBe(0);
    expect(await t.run(async (ctx) => saas.metric(ctx, "signup"))).toBe(1);
    expect(await t.run(async (ctx) => saas.metric(ctx, "round_played"))).toBe(0);
  });
});
