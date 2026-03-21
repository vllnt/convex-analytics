import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { ConvexAnalytics } from "convex-analytics";
import { v } from "convex/values";

type MyEvents = {
  page_view: {};
  signup: { plan: "free" | "pro" };
  tutorial_start: { tutorialId: string };
  tutorial_complete: { tutorialId: string; duration: number };
};

const analytics = new ConvexAnalytics<MyEvents>(components.analytics);

export const trackEvent = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    name: v.string(),
    properties: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await analytics.track(
      ctx,
      args.userId,
      args.sessionId,
      args.name as keyof MyEvents & string,
      args.properties,
      { path: "/demo", locale: "en", country: "US" },
    );
  },
});

export const getSummary = query({
  args: {},
  handler: async (ctx) => {
    return analytics.summary(ctx);
  },
});
