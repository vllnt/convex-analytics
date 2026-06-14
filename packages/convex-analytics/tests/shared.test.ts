import { describe, it, expect } from "vitest";
import { bucketStart, bucketSize, valKey } from "../src/shared.js";

describe("shared helpers", () => {
  it("bucketStart truncates to hour and day boundaries", () => {
    const ts = Date.UTC(2026, 0, 15, 10, 37, 12);
    expect(bucketStart(ts, "hour")).toBe(Date.UTC(2026, 0, 15, 10, 0, 0));
    expect(bucketStart(ts, "day")).toBe(Date.UTC(2026, 0, 15, 0, 0, 0));
  });

  it("bucketSize returns hour/day millis", () => {
    expect(bucketSize("hour")).toBe(3600000);
    expect(bucketSize("day")).toBe(86400000);
  });

  it("valKey stringifies scalars and maps null to 'null'", () => {
    expect(valKey("x")).toBe("x");
    expect(valKey(42)).toBe("42");
    expect(valKey(true)).toBe("true");
    expect(valKey(false)).toBe("false");
    expect(valKey(null)).toBe("null");
  });
});
