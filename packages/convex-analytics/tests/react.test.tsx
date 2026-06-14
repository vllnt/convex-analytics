import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

/**
 * Controlled `convex/react`: `useQuery` records its (ref, ...args) and returns a
 * scripted value, so each hook's arg-passing + reactive return is asserted
 * without a live Convex backend (that is the consuming app's E2E).
 */
const calls: Array<{ ref: unknown; args: unknown[] }> = [];
let nextReturn: unknown;

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, ...args: unknown[]) => {
    calls.push({ ref, args });
    return nextReturn;
  },
}));

import {
  useMetric,
  useTop,
  useTimeseries,
  useUniques,
} from "../src/react/index.js";

const metricRef = { kind: "metric" } as never;
const topRef = { kind: "top" } as never;
const timeseriesRef = { kind: "timeseries" } as never;
const uniquesRef = { kind: "uniques" } as never;

beforeEach(() => {
  calls.length = 0;
  nextReturn = undefined;
});

describe("react hooks — arg passing + reactive return", () => {
  it("useMetric forwards ref + args and returns the query value", () => {
    nextReturn = 42;
    const { result } = renderHook(() =>
      useMetric(metricRef, { name: "signup", range: { from: 1, to: 2 } }),
    );
    expect(result.current).toBe(42);
    expect(calls).toEqual([
      { ref: metricRef, args: [{ name: "signup", range: { from: 1, to: 2 } }] },
    ]);
  });

  it("useMetric returns undefined while loading", () => {
    const { result } = renderHook(() => useMetric(metricRef, { name: "x" }));
    expect(result.current).toBeUndefined();
  });

  it("useTop forwards ref + args and returns rows", () => {
    nextReturn = [{ value: "pro", count: 3 }];
    const { result } = renderHook(() =>
      useTop(topRef, { name: "signup", dimension: "plan" }),
    );
    expect(result.current).toEqual([{ value: "pro", count: 3 }]);
    expect(calls[0]).toEqual({
      ref: topRef,
      args: [{ name: "signup", dimension: "plan" }],
    });
  });

  it("useTimeseries forwards ref + args and returns points", () => {
    nextReturn = [{ bucket: 0, count: 5 }];
    const { result } = renderHook(() =>
      useTimeseries(timeseriesRef, {
        name: "visit",
        granularity: "day",
        range: {},
      }),
    );
    expect(result.current).toEqual([{ bucket: 0, count: 5 }]);
    expect(calls[0]!.ref).toBe(timeseriesRef);
  });

  it("useUniques forwards ref + args and returns the view", () => {
    nextReturn = { dau: 1, wau: 1, mau: 1, trend: [] };
    const { result } = renderHook(() =>
      useUniques(uniquesRef, { range: {}, granularity: "day" }),
    );
    expect(result.current).toEqual({ dau: 1, wau: 1, mau: 1, trend: [] });
    expect(calls[0]!.ref).toBe(uniquesRef);
  });

  it("passes 'skip' through to defer a query", () => {
    renderHook(() => useMetric(metricRef, "skip"));
    expect(calls[0]!.args).toEqual(["skip"]);
  });
});
