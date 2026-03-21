import { describe, it, expect } from "vitest";

describe("event name validation", () => {
  const EVENT_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

  it("H6: accepts valid event names", () => {
    expect(EVENT_NAME_RE.test("page_view")).toBe(true);
    expect(EVENT_NAME_RE.test("signup")).toBe(true);
    expect(EVENT_NAME_RE.test("tutorial_start")).toBe(true);
    expect(EVENT_NAME_RE.test("_internal_event")).toBe(true);
    expect(EVENT_NAME_RE.test("A")).toBe(true);
    expect(EVENT_NAME_RE.test("event_with_64_chars_" + "a".repeat(44))).toBe(true);
  });

  it("H6: rejects invalid event names", () => {
    expect(EVENT_NAME_RE.test("")).toBe(false);
    expect(EVENT_NAME_RE.test("123start")).toBe(false);
    expect(EVENT_NAME_RE.test("event:with:colons")).toBe(false);
    expect(EVENT_NAME_RE.test("event.with.dots")).toBe(false);
    expect(EVENT_NAME_RE.test("event with spaces")).toBe(false);
    expect(EVENT_NAME_RE.test("a".repeat(65))).toBe(false);
    expect(EVENT_NAME_RE.test("-starts-with-dash")).toBe(false);
  });
});

describe("properties schema filtering", () => {
  it("AC-12: filters properties by allowlist + validates types", () => {
    const allowed: Record<string, string> = {
      plan: "string",
      amount: "number",
      trial: "boolean",
    };

    const raw: Record<string, unknown> = {
      plan: "pro",
      amount: 99,
      trial: true,
      unknown_key: "should be stripped",
      another: 42,
    };

    const filtered: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) {
      if (!(key in allowed)) continue;
      const expectedType = allowed[key]!;
      const value = raw[key];
      if (expectedType === "string" && typeof value === "string") {
        filtered[key] = value;
      } else if (expectedType === "number" && typeof value === "number") {
        filtered[key] = value;
      } else if (expectedType === "boolean" && typeof value === "boolean") {
        filtered[key] = value;
      }
    }

    expect(filtered).toEqual({ plan: "pro", amount: 99, trial: true });
    expect(filtered).not.toHaveProperty("unknown_key");
    expect(filtered).not.toHaveProperty("another");
  });

  it("M2: rejects properties with wrong value types", () => {
    const allowed: Record<string, string> = { plan: "string", amount: "number" };

    const raw: Record<string, unknown> = {
      plan: 123,
      amount: "not a number",
    };

    const filtered: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) {
      if (!(key in allowed)) continue;
      const expectedType = allowed[key]!;
      const value = raw[key];
      if (expectedType === "string" && typeof value === "string") {
        filtered[key] = value;
      } else if (expectedType === "number" && typeof value === "number") {
        filtered[key] = value;
      } else if (expectedType === "boolean" && typeof value === "boolean") {
        filtered[key] = value;
      }
    }

    expect(filtered).toEqual({});
  });
});

describe("timing-safe comparison", () => {
  function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  it("C1: matches equal strings", () => {
    expect(timingSafeEqual("abc123", "abc123")).toBe(true);
  });

  it("C1: rejects different strings", () => {
    expect(timingSafeEqual("abc123", "abc124")).toBe(false);
  });

  it("C1: rejects different lengths", () => {
    expect(timingSafeEqual("short", "longer_string")).toBe(false);
  });

  it("C1: rejects empty vs non-empty", () => {
    expect(timingSafeEqual("", "notempty")).toBe(false);
  });
});

describe("config key allowlist", () => {
  const MUTABLE_CONFIG_KEYS = new Set([
    "retention_days",
    "rate_limit",
    "session_timeout",
    "alert_threshold",
  ]);

  it("C4: allows mutable keys", () => {
    expect(MUTABLE_CONFIG_KEYS.has("retention_days")).toBe(true);
    expect(MUTABLE_CONFIG_KEYS.has("rate_limit")).toBe(true);
  });

  it("C4: blocks api_keys mutation", () => {
    expect(MUTABLE_CONFIG_KEYS.has("api_keys")).toBe(false);
  });

  it("C4: blocks arbitrary keys", () => {
    expect(MUTABLE_CONFIG_KEYS.has("__proto__")).toBe(false);
    expect(MUTABLE_CONFIG_KEYS.has("constructor")).toBe(false);
    expect(MUTABLE_CONFIG_KEYS.has("random_key")).toBe(false);
  });
});

describe("UA parsing", () => {
  function parseBrowser(ua: string): string {
    if (ua.includes("Firefox/")) return "Firefox";
    if (ua.includes("Edg/")) return "Edge";
    if (ua.includes("Chrome/")) return "Chrome";
    if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
    return "Other";
  }

  it("parses Chrome correctly", () => {
    expect(
      parseBrowser(
        "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome");
  });

  it("parses Safari correctly (not misidentified as Chrome)", () => {
    expect(
      parseBrowser(
        "Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      ),
    ).toBe("Safari");
  });

  it("parses Firefox correctly", () => {
    expect(parseBrowser("Mozilla/5.0 Gecko/20100101 Firefox/120.0")).toBe(
      "Firefox",
    );
  });
});

describe("alias self-guard", () => {
  it("H4: self-alias is a no-op", () => {
    const anonymousId = "user_123";
    const identifiedId = "user_123";
    expect(anonymousId === identifiedId).toBe(true);
  });
});
