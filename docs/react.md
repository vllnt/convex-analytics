# React hooks reference

`@vllnt/convex-analytics/react` has four hooks that wrap `useQuery` from `convex/react` for the
aggregate reads. `react` is an optional peer dependency; backend-only code never imports this
entry. The hooks need a `ConvexProvider` above them.

The component never owns your `api`. Write a public query in your Convex functions that calls
the matching `AnalyticsClient` method, then pass that query's reference to the hook. The hook
forwards your args (or `"skip"`) and returns `undefined` while loading. The hooks only fix the
return type; your query decides who may read and which `scope` it reads.

Source: `src/react/index.tsx` in the package (`packages/convex-analytics/src/react/index.tsx` in
the repository).

```ts
// convex/stats.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics, { dimensions: ["plan"] });
const range = v.object({ from: v.optional(v.number()), to: v.optional(v.number()) });
const granularity = v.union(v.literal("minute"), v.literal("hour"), v.literal("day"));

export const metric = query({
  args: { name: v.string(), range: v.optional(range) },
  returns: v.number(),
  handler: async (ctx, args) => await analytics.metric(ctx, args.name, { range: args.range }),
});

export const top = query({
  args: { name: v.string(), dimension: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.object({ value: v.string(), count: v.number() })),
  handler: async (ctx, args) =>
    await analytics.top(ctx, args.name, args.dimension, { limit: args.limit }),
});

export const timeseries = query({
  args: { name: v.string(), granularity, range },
  returns: v.array(v.object({ bucket: v.number(), count: v.number() })),
  handler: async (ctx, args) =>
    await analytics.timeseries(ctx, args.name, { granularity: args.granularity, range: args.range }),
});

export const uniques = query({
  args: { granularity, range },
  returns: v.object({
    dau: v.number(),
    wau: v.number(),
    mau: v.number(),
    trend: v.array(v.object({ bucket: v.number(), uniques: v.number() })),
  }),
  handler: async (ctx, args) => await analytics.uniques(ctx, args),
});
```

```tsx
// src/Stats.tsx
import { useMetric, useTimeseries, useTop, useUniques } from "@vllnt/convex-analytics/react";

import { api } from "../convex/_generated/api";

export function Stats({ from, to }: { from: number; to: number }) {
  const signups = useMetric(api.stats.metric, { name: "signup" });
  const plans = useTop(api.stats.top, { name: "signup", dimension: "plan" });
  const daily = useTimeseries(api.stats.timeseries, {
    name: "signup",
    granularity: "day",
    range: { from, to },
  });
  const active = useUniques(api.stats.uniques, { granularity: "day", range: { from, to } });
  if (signups === undefined || plans === undefined || daily === undefined || active === undefined) {
    return <p>Loading</p>;
  }
  return (
    <p>
      {signups} signups, top plan {plans[0]?.value ?? "none"}, {daily.length} active days,{" "}
      {active.mau} monthly users
    </p>
  );
}
```

## useMetric

```ts
// signature
useMetric(ref: FunctionReference<"query", "public", any, number>, args | "skip"): number | undefined
```

## useTop

```ts
// signature
useTop(ref: FunctionReference<"query", "public", any, TopRow[]>, args | "skip"): TopRow[] | undefined
```

## useTimeseries

```ts
// signature
useTimeseries(ref: FunctionReference<"query", "public", any, TimeseriesPoint[]>, args | "skip"): TimeseriesPoint[] | undefined
```

## useUniques

```ts
// signature
useUniques(ref: FunctionReference<"query", "public", any, UniquesView>, args | "skip"): UniquesView | undefined
```

## MetricArgs

```ts
// signature
interface MetricArgs { scope?: string; name: string; range?: Range; where?: Where }
```

## TopArgs

```ts
// signature
interface TopArgs { scope?: string; name: string; dimension: string; range?: Range; limit?: number }
```

## TimeseriesArgs

```ts
// signature
interface TimeseriesArgs { scope?: string; name: string; granularity: Granularity; range: Range; where?: Where }
```

## UniquesArgs

```ts
// signature
interface UniquesArgs { scope?: string; range: Range; granularity: Granularity }
```

These four interfaces document the args a host query is expected to accept. The hooks do not
enforce them: the args type comes from the query reference you pass.

The entry also re-exports the types `Range`, `Where`, `Granularity`, `TopRow`,
`TimeseriesPoint` and `UniquesView` (see [Client SDK](./client-sdk.md#types)).
