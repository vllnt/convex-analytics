/**
 * Optional React hooks for `@vllnt/convex-analytics`.
 *
 * Thin, tree-shakeable wrappers over `convex/react`'s `useQuery` for the
 * component's **aggregate** read verbs (metric, timeseries, top, uniques).
 * The backend core installs and runs with zero React — these hooks are an
 * opt-in `./react` entry; `react` and `convex` are optional peer deps.
 *
 * No-leak: aggregates ONLY (no raw events) and every call is scope-gated, so a
 * hook can never surface another scope's rows or a raw event payload on the
 * client.
 *
 * The component never owns the host's `api`. The host re-exports the analytics
 * query refs from its own Convex functions and passes the matching ref into
 * each hook — these wrappers forward the host's exact args and the reactive
 * return, while pinning the aggregate return type for ergonomics.
 *
 * @packageDocumentation
 */

import { useQuery } from "convex/react";
import type { OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference, DefaultFunctionArgs } from "convex/server";
import type {
  Range,
  Where,
  Granularity,
  TopRow,
  TimeseriesPoint,
  UniquesView,
} from "../client/types.js";

export type { Range, Where, Granularity, TopRow, TimeseriesPoint, UniquesView };

/** A host-re-exported public analytics query ref returning `R`. */
type QueryRef<R> = FunctionReference<"query", "public", DefaultFunctionArgs, R>;

/** The args a host's re-exported `metric` query is expected to accept. */
export interface MetricArgs {
  scope?: string;
  name: string;
  range?: Range;
  where?: Where;
}

/** The args a host's re-exported `top` query is expected to accept. */
export interface TopArgs {
  scope?: string;
  name: string;
  dimension: string;
  range?: Range;
  limit?: number;
}

/** The args a host's re-exported `timeseries` query is expected to accept. */
export interface TimeseriesArgs {
  scope?: string;
  name: string;
  granularity: Granularity;
  range: Range;
  where?: Where;
}

/** The args a host's re-exported `uniques` query is expected to accept. */
export interface UniquesArgs {
  scope?: string;
  range: Range;
  granularity: Granularity;
}

/**
 * Reactive total count for an event over a range (optionally filtered).
 *
 * @param ref - The host's re-exported `metric` query reference.
 * @param args - The query args (`{ name, scope?, range?, where? }`), or
 *   `"skip"` to defer until ready. The host ref's own validator is the
 *   contract; {@link MetricArgs} documents the expected shape.
 * @returns The count, or `undefined` while loading.
 */
export function useMetric<Ref extends QueryRef<number>>(
  ref: Ref,
  ...args: OptionalRestArgsOrSkip<Ref>
): number | undefined {
  return useQuery(ref, ...args);
}

/**
 * Reactive breakdown — top values of a dimension for an event.
 *
 * @param ref - The host's re-exported `top` query reference.
 * @param args - `{ name, dimension, scope?, range?, limit? }`, or `"skip"`.
 * @returns The rows, or `undefined` while loading.
 */
export function useTop<Ref extends QueryRef<TopRow[]>>(
  ref: Ref,
  ...args: OptionalRestArgsOrSkip<Ref>
): TopRow[] | undefined {
  return useQuery(ref, ...args);
}

/**
 * Reactive bucketed counts for an event over a range.
 *
 * @param ref - The host's re-exported `timeseries` query reference.
 * @param args - `{ name, granularity, range, scope?, where? }`, or `"skip"`.
 * @returns The points, or `undefined` while loading.
 */
export function useTimeseries<Ref extends QueryRef<TimeseriesPoint[]>>(
  ref: Ref,
  ...args: OptionalRestArgsOrSkip<Ref>
): TimeseriesPoint[] | undefined {
  return useQuery(ref, ...args);
}

/**
 * Reactive DAU/WAU/MAU + trend from subjects.
 *
 * @param ref - The host's re-exported `uniques` query reference.
 * @param args - `{ range, granularity, scope? }`, or `"skip"`.
 * @returns The uniques view, or `undefined` while loading.
 */
export function useUniques<Ref extends QueryRef<UniquesView>>(
  ref: Ref,
  ...args: OptionalRestArgsOrSkip<Ref>
): UniquesView | undefined {
  return useQuery(ref, ...args);
}
