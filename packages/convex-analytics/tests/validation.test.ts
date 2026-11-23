/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { ConvexError } from "convex/values";
import { api } from "../src/component/_generated/api.js";
import { withInputErrors } from "../src/component/http.js";
import { initConvexTest } from "./test-helpers.js";

const D = (day: number) => Date.UTC(2026, 0, day, 10, 0, 0);
const KEY = "secret-key";
const auth = { "x-api-key": KEY } as Record<string, string>;
const base = { scope: "s", name: "e", dimensions: [], granularities: [] as [] };

type T = ReturnType<typeof initConvexTest>;

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ data: { code } });
}

async function seeded(): Promise<T> {
  const t = initConvexTest();
  await t.mutation(api.mutations.configSet, {
    scope: "s",
    key: "apiKeys",
    value: JSON.stringify([KEY]),
  });
  return t;
}

describe("track input validation", () => {
  it.each([NaN, Infinity, -Infinity])("rejects ts=%s and stores nothing", async (ts) => {
    const t = initConvexTest();
    await expectCode(t.mutation(api.mutations.track, { ...base, ts }), "INVALID_TIMESTAMP");
    expect(await t.query(api.queries.metric, { scope: "s", name: "e" })).toBe(0);
    expect(
      await t.query(api.queries.timeseries, {
        scope: "s",
        name: "e",
        granularity: "day",
        range: {},
      }),
    ).toEqual([]);
  });

  it.each([
    ["scope", { scope: "" }],
    ["name", { name: "" }],
    ["subjectRef", { subjectRef: "" }],
    ["sessionRef", { sessionRef: "" }],
    ["dedupeKey", { dedupeKey: "" }],
    ["dimensions", { dimensions: [""] }],
  ])("rejects an empty %s", async (_field, override) => {
    const t = initConvexTest();
    await expectCode(t.mutation(api.mutations.track, { ...base, ...override }), "EMPTY_STRING");
  });

  it.each([NaN, -0.1, 1.1, Infinity])("rejects sampleRate=%s", async (sampleRate) => {
    const t = initConvexTest();
    await expectCode(
      t.mutation(api.mutations.track, { ...base, sampleRate }),
      "INVALID_SAMPLE_RATE",
    );
  });

  it.each([NaN, Infinity])("rejects a non-finite number prop (%s)", async (n) => {
    const t = initConvexTest();
    await expectCode(
      t.mutation(api.mutations.track, { ...base, props: { size: n } }),
      "INVALID_PROP_VALUE",
    );
  });

  it("does not roll up dimensions inherited from Object.prototype", async () => {
    const t = initConvexTest();
    await t.mutation(api.mutations.track, {
      ...base,
      props: { plan: "pro" },
      dimensions: ["constructor", "plan"],
      granularities: ["day"],
    });
    expect(
      await t.query(api.queries.top, { scope: "s", name: "e", dimension: "constructor" }),
    ).toEqual([]);
    expect(
      await t.query(api.queries.top, { scope: "s", name: "e", dimension: "plan" }),
    ).toEqual([{ value: "pro", count: 1 }]);
  });
});

describe("config input validation", () => {
  it("rejects empty scope and key in configSet and empty scope in configure", async () => {
    const t = initConvexTest();
    await expectCode(
      t.mutation(api.mutations.configSet, { scope: "", key: "k", value: "v" }),
      "EMPTY_STRING",
    );
    await expectCode(
      t.mutation(api.mutations.configSet, { scope: "s", key: "", value: "v" }),
      "EMPTY_STRING",
    );
    await expectCode(t.mutation(api.mutations.configure, { scope: "" }), "EMPTY_STRING");
  });

  it.each([
    { retentionDays: -1 },
    { retentionDays: 0 },
    { retentionDays: NaN },
    { sessionIdleMs: -5 },
    { sessionIdleMs: Infinity },
  ])("rejects configure(%o)", async (opts) => {
    const t = initConvexTest();
    await expectCode(
      t.mutation(api.mutations.configure, { scope: "s", ...opts }),
      "INVALID_CONFIG",
    );
  });

  it("rejects an out-of-range sampleRate in configure", async () => {
    const t = initConvexTest();
    await expectCode(
      t.mutation(api.mutations.configure, { scope: "s", sampleRate: 2 }),
      "INVALID_SAMPLE_RATE",
    );
  });
});

describe("query input validation", () => {
  const nan = { from: NaN };
  const inf = { to: Infinity };

  it("rejects non-finite range bounds on every ranged query", async () => {
    const t = initConvexTest();
    const q = api.queries;
    await expectCode(t.query(q.metric, { scope: "s", name: "e", range: nan }), "INVALID_TIMESTAMP");
    await expectCode(
      t.query(q.top, { scope: "s", name: "e", dimension: "d", range: inf }),
      "INVALID_TIMESTAMP",
    );
    await expectCode(
      t.query(q.timeseries, { scope: "s", name: "e", granularity: "day", range: nan }),
      "INVALID_TIMESTAMP",
    );
    await expectCode(
      t.query(q.uniques, { scope: "s", granularity: "day", range: inf }),
      "INVALID_TIMESTAMP",
    );
    await expectCode(
      t.query(q.funnel, { scope: "s", steps: ["a", "b"], range: nan }),
      "INVALID_TIMESTAMP",
    );
    await expectCode(
      t.query(q.retention, { scope: "s", cohortRange: nan, periods: 3 }),
      "INVALID_TIMESTAMP",
    );
    await expectCode(
      t.query(q.distribution, { scope: "s", name: "e", measure: "m", buckets: [1], range: inf }),
      "INVALID_TIMESTAMP",
    );
  });

  it.each([0, -1, 2.5, NaN])("top rejects limit=%s (negative limit used to slice from the end)", async (limit) => {
    const t = initConvexTest();
    await expectCode(
      t.query(api.queries.top, { scope: "s", name: "e", dimension: "d", limit }),
      "INVALID_COUNT",
    );
  });

  it("top with a valid limit returns exactly that many rows", async () => {
    const t = initConvexTest();
    for (const plan of ["a", "b", "c"]) {
      await t.mutation(api.mutations.track, {
        ...base,
        props: { plan },
        dimensions: ["plan"],
        granularities: ["day"],
        ts: D(1),
      });
    }
    const rows = await t.query(api.queries.top, {
      scope: "s",
      name: "e",
      dimension: "plan",
      limit: 2,
    });
    expect(rows).toHaveLength(2);
  });

  it.each([0, -3, 1.5, NaN])("retention rejects periods=%s", async (periods) => {
    const t = initConvexTest();
    await expectCode(
      t.query(api.queries.retention, { scope: "s", cohortRange: {}, periods }),
      "INVALID_COUNT",
    );
  });

  it("distribution rejects non-finite bucket bounds", async () => {
    const t = initConvexTest();
    await expectCode(
      t.query(api.queries.distribution, { scope: "s", name: "e", measure: "m", buckets: [1, NaN] }),
      "INVALID_BUCKETS",
    );
  });

  it.each([0, -1, 1.5, NaN])("list rejects numItems=%s", async (numItems) => {
    const t = initConvexTest();
    await expectCode(
      t.query(api.queries.list, {
        scope: "s",
        name: "e",
        paginationOpts: { numItems, cursor: null },
      }),
      "INVALID_COUNT",
    );
  });

  it("list rejects a cursor that is not a timestamp", async () => {
    const t = initConvexTest();
    await expectCode(
      t.query(api.queries.list, {
        scope: "s",
        name: "e",
        paginationOpts: { numItems: 5, cursor: "garbage" },
      }),
      "INVALID_CURSOR",
    );
  });
});

describe("range reads only load the requested buckets", () => {
  it("metric / top / timeseries / uniques honour inclusive day bounds", async () => {
    const t = initConvexTest();
    for (const day of [1, 2, 3]) {
      await t.mutation(api.mutations.track, {
        ...base,
        subjectRef: `u${day}`,
        props: { plan: `p${day}` },
        dimensions: ["plan"],
        granularities: ["day"],
        ts: D(day),
      });
    }
    const range = { from: D(2), to: D(2) };
    expect(await t.query(api.queries.metric, { scope: "s", name: "e", range })).toBe(1);
    expect(
      await t.query(api.queries.top, { scope: "s", name: "e", dimension: "plan", range }),
    ).toEqual([{ value: "p2", count: 1 }]);
    const points = await t.query(api.queries.timeseries, {
      scope: "s",
      name: "e",
      granularity: "day",
      range: { to: D(2) },
    });
    expect(points.map((p) => p.count)).toEqual([1, 1]);
    const uniques = await t.query(api.queries.uniques, {
      scope: "s",
      granularity: "day",
      range: { from: D(2), to: D(3) },
    });
    expect(uniques.trend.map((p) => p.uniques)).toEqual([1, 1]);
  });
});

describe("HTTP input handling", () => {
  const post = (t: T, body: unknown) =>
    t.fetch("/track", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it.each(["null", "[]", "42", '"x"'])("400s on a non-object body (%s)", async (raw) => {
    const t = await seeded();
    // scope defaults to "default", which has no keys here; configure it too.
    await t.mutation(api.mutations.configSet, {
      scope: "default",
      key: "apiKeys",
      value: JSON.stringify([KEY]),
    });
    expect((await post(t, raw)).status).toBe(400);
  });

  it("400s on bad dimensions, props and granularities instead of failing the action", async () => {
    const t = await seeded();
    const ok = { scope: "s", name: "e", dimensions: [] };
    expect((await post(t, { ...ok, dimensions: [1] })).status).toBe(400);
    expect((await post(t, { ...ok, props: "x" })).status).toBe(400);
    expect((await post(t, { ...ok, props: [1] })).status).toBe(400);
    expect((await post(t, { ...ok, granularities: ["week"] })).status).toBe(400);
    expect((await post(t, { ...ok, granularities: "day" })).status).toBe(400);
  });

  it("400s with the typed code for ts=1e999 (parses to Infinity) and stores nothing", async () => {
    const t = await seeded();
    const res = await post(t, '{"scope":"s","name":"e","dimensions":[],"ts":1e999}');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "ts must be a finite number",
      code: "INVALID_TIMESTAMP",
    });
    expect(await t.query(api.queries.metric, { scope: "s", name: "e" })).toBe(0);
  });

  it("400s on a prop key Convex cannot store instead of failing the action", async () => {
    const t = await seeded();
    for (const key of ["$bad", "é", "a\nb", "x".repeat(1025)]) {
      const res = await post(t, { scope: "s", name: "e", dimensions: [], props: { [key]: 1 } });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_PROP_KEY");
    }
  });

  it("400s on a non-finite prop value and on empty-string refs", async () => {
    const t = await seeded();
    const ok = { scope: "s", name: "e", dimensions: [] };
    expect((await post(t, '{"scope":"s","name":"e","dimensions":[],"props":{"n":1e999}}')).status).toBe(400);
    expect((await post(t, { ...ok, subjectRef: "" })).status).toBe(400);
  });

  it("400s on malformed numeric query params instead of silently widening the range", async () => {
    const t = await seeded();
    const get = (path: string) => t.fetch(`${path}&scope=s`, { headers: auth });
    expect((await get("/metric?name=e&from=abc")).status).toBe(400);
    expect((await get("/metric?name=e&to=")).status).toBe(400);
    expect((await get("/top?name=e&dimension=d&limit=abc")).status).toBe(400);
    expect((await get("/top?name=e&dimension=d&limit=-1")).status).toBe(400);
    expect((await get("/timeseries?name=e&from=1e999")).status).toBe(400);
    expect((await get("/uniques?from=NaN")).status).toBe(400);
  });

  it("400s on nested or array prop values", async () => {
    const t = await seeded();
    for (const bad of [{ a: 1 }, [1]]) {
      const res = await post(t, { scope: "s", name: "e", dimensions: [], props: { n: bad } });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("INVALID_PROP_VALUE");
    }
  });

  it("reports a stored API key list that is not valid JSON as misconfigured", async () => {
    const t = await seeded();
    await t.mutation(api.mutations.configSet, { scope: "s", key: "apiKeys", value: "{" });
    const res = await t.fetch("/metric?name=e&scope=s", { headers: auth });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "API keys misconfigured" });
  });

  it("treats a non-array or non-string apiKeys value as misconfigured", async () => {
    const t = await seeded();
    for (const value of ['"just-a-string"', "[1,2]"]) {
      await t.mutation(api.mutations.configSet, { scope: "s", key: "apiKeys", value });
      const res = await t.fetch("/metric?name=e&scope=s", { headers: auth });
      expect(res.status).toBe(500);
    }
  });
});

describe("withInputErrors", () => {
  it("maps a typed input error to 400 and rethrows everything else", async () => {
    const typed = await withInputErrors(() =>
      Promise.reject(new ConvexError({ code: "INVALID_COUNT", message: "limit bad" })),
    );
    expect(typed.status).toBe(400);
    expect(await typed.json()).toEqual({ error: "limit bad", code: "INVALID_COUNT" });

    const untyped = new ConvexError("plain string data");
    await expect(withInputErrors(() => Promise.reject(untyped))).rejects.toBe(untyped);
    const unknown = new Error("boom");
    await expect(withInputErrors(() => Promise.reject(unknown))).rejects.toBe(unknown);
  });
});
