import { describe, it, expect, vi } from "vitest";
import { ConvexAnalytics } from "../src/client.js";

const componentMock = {
  track: { track: "mock_ref", identify: "mock_ref", alias: "mock_ref" },
  queries: { count: "mock_ref", list: "mock_ref", summary: "mock_ref" },
};

describe("ConvexAnalytics client", () => {
  it("AC-15b: debug(true) logs track calls to console", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const analytics = new ConvexAnalytics(componentMock);
    analytics.debug(true);

    const mockCtx = { runMutation: vi.fn().mockResolvedValue(null) };

    await analytics.track(mockCtx as never, "u1", "s1", "signup", { plan: "pro" });

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

  it("AC-15c: debug(false) produces no console output", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const analytics = new ConvexAnalytics(componentMock);
    analytics.debug(false);

    const mockCtx = { runMutation: vi.fn().mockResolvedValue(null) };

    await analytics.track(mockCtx as never, "u1", "s1", "signup");

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("AC-14f: untyped instance accepts any event name and properties", async () => {
    const analytics = new ConvexAnalytics(componentMock);
    const mockCtx = { runMutation: vi.fn().mockResolvedValue(null) };

    await analytics.track(mockCtx as never, "u1", "s1", "anything");
    await analytics.track(mockCtx as never, "u1", "s1", "whatever", { foo: true });
    await analytics.track(mockCtx as never, "u1", "s1", "random_event", { x: 1, y: "z" });

    expect(mockCtx.runMutation).toHaveBeenCalledTimes(3);
  });

  it("AC-14g: typed instance constrains event names (runtime smoke test)", async () => {
    type MyEvents = {
      signup: { plan: "free" | "pro" };
      page_view: Record<string, never>;
    };

    const analytics = new ConvexAnalytics<MyEvents>(componentMock);
    const mockCtx = { runMutation: vi.fn().mockResolvedValue(null) };

    await analytics.track(mockCtx as never, "u1", "s1", "signup", { plan: "pro" });
    await analytics.track(mockCtx as never, "u1", "s1", "page_view");

    expect(mockCtx.runMutation).toHaveBeenCalledTimes(2);
  });
});
