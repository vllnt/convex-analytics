import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { v } from "convex/values";

type MyProps = {
  plan?: string;
  tutorialId?: string;
  duration?: number;
  attempts?: number;
};

const analytics = new AnalyticsClient<MyProps>(components.analytics, {
  dimensions: ["plan"],
  granularities: ["day"],
});

export const trackEvent = mutation({
  args: {
    name: v.string(),
    subjectRef: v.optional(v.string()),
    sessionRef: v.optional(v.string()),
    props: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()))),
  },
  handler: async (ctx, args) => {
    return analytics.track(ctx, args.name, {
      subjectRef: args.subjectRef,
      sessionRef: args.sessionRef,
      props: args.props as MyProps | undefined,
    });
  },
});

export const getMetric = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    return analytics.metric(ctx, args.name);
  },
});

export const getTop = query({
  args: {
    name: v.string(),
    dimension: v.string(),
  },
  handler: async (ctx, args) => {
    return analytics.top(ctx, args.name, args.dimension);
  },
});

export const getTimeseries = query({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return analytics.timeseries(ctx, args.name, {
      granularity: "day",
      range: { from: now - 30 * 24 * 60 * 60 * 1000, to: now },
    });
  },
});

export const getUniques = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return analytics.uniques(ctx, {
      range: { from: now - 7 * 24 * 60 * 60 * 1000, to: now },
      granularity: "day",
    });
  },
});

export const getDistribution = query({
  args: {
    name: v.string(),
    measure: v.string(),
    buckets: v.array(v.number()),
  },
  handler: async (ctx, args) => {
    return analytics.distribution(ctx, args.name, args.measure, {
      buckets: args.buckets,
    });
  },
});

const WINDOW = 30 * 24 * 60 * 60 * 1000;

export const getFunnel = query({
  args: { steps: v.array(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    return analytics.funnel(ctx, args.steps, {
      range: { from: now - WINDOW, to: now + WINDOW },
    });
  },
});

export const getRetention = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return analytics.retention(ctx, {
      cohortRange: { from: now - WINDOW, to: now + WINDOW },
      periods: 3,
    });
  },
});

export const getList = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    return analytics.list(ctx, args.name, { numItems: 10, cursor: null });
  },
});
