import { describe, it, expect, vi } from "vitest";
import { ConvexAnalytics } from "../src/client.js";

describe("ConvexAnalytics client", () => {
  it("AC-15b: debug(true) logs track calls to console", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const analytics = new ConvexAnalytics({});
    analytics.debug(true);

    // track() will fail without real ctx, but debug log fires before the mutation call
    const mockCtx = {
      runMutation: vi.fn().mockResolvedValue(null),
    };

    analytics.track(mockCtx as never, "u1", "s1", "signup", { plan: "pro" });

    expect(spy).toHaveBeenCalledWith(
      "[convex-analytics] track",
      expect.objectContaining({
        name: "signup",
        userId: "u1",
        sessionId: "s1",
      }),
    );

    spy.mockRestore();
  });

  it("AC-15c: debug(false) produces no console output", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const analytics = new ConvexAnalytics({});
    analytics.debug(false);

    const mockCtx = {
      runMutation: vi.fn().mockResolvedValue(null),
    };

    analytics.track(mockCtx as never, "u1", "s1", "signup");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("AC-14f: untyped instance accepts any event name and properties", async () => {
    const analytics = new ConvexAnalytics({});
    const mockCtx = {
      runMutation: vi.fn().mockResolvedValue(null),
    };

    // Wrap component to have the expected shape
    const componentMock = { track: { track: "mock_ref", identify: "mock_ref", alias: "mock_ref" } };
    const typedAnalytics = new ConvexAnalytics(componentMock);

    // These should all compile without error
    await typedAnalytics.track(mockCtx as never, "u1", "s1", "anything");
    await typedAnalytics.track(mockCtx as never, "u1", "s1", "whatever", { foo: true });
    await typedAnalytics.track(mockCtx as never, "u1", "s1", "random_event", { x: 1, y: "z" });

    expect(mockCtx.runMutation).toHaveBeenCalledTimes(3);
  });

  it("AC-14g: typed instance constrains event names (runtime smoke test)", async () => {
    type MyEvents = {
      signup: { plan: "free" | "pro" };
      page_view: Record<string, never>;
    };

    const componentMock = { track: { track: "mock_ref", identify: "mock_ref", alias: "mock_ref" } };
    const analytics = new ConvexAnalytics<MyEvents>(componentMock);
    const mockCtx = { runMutation: vi.fn().mockResolvedValue(null) };

    // These should compile:
    await analytics.track(mockCtx as never, "u1", "s1", "signup", { plan: "pro" });
    await analytics.track(mockCtx as never, "u1", "s1", "page_view");

    expect(mockCtx.runMutation).toHaveBeenCalledTimes(2);

    // Note: analytics.track(mockCtx, "u1", "s1", "nonexistent_event")
    // would be a compile error with typed instance.
  });
});
