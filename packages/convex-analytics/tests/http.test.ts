/// <reference types="vite/client" />
import { describe, it, expect, beforeEach } from "vitest";
import { api } from "../src/component/_generated/api.js";
import { initConvexTest } from "./test-helpers.js";

const KEY = "secret-key";
const D = (day: number) => Date.UTC(2026, 0, day, 10, 0, 0);

async function withKey(t: ReturnType<typeof initConvexTest>, scope = "default"): Promise<void> {
  await t.mutation(api.mutations.configSet, {
    scope, key: "apiKeys", value: JSON.stringify([KEY]),
  });
}

const auth = { "x-api-key": KEY } as Record<string, string>;

describe("http auth", () => {
  let t: ReturnType<typeof initConvexTest>;
  beforeEach(async () => {
    t = initConvexTest();
    await withKey(t);
  });

  it("401s with no x-api-key header", async () => {
    const res = await t.fetch("/metric?name=e", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("401s when apiKeys is unconfigured for the scope", async () => {
    const res = await t.fetch("/metric?name=e&scope=other", { method: "GET", headers: auth });
    expect(res.status).toBe(401);
  });

  it("401s with a wrong key", async () => {
    const res = await t.fetch("/metric?name=e", { method: "GET", headers: { "x-api-key": "nope" } });
    expect(res.status).toBe(401);
  });

  it("401s on /track, /top, /timeseries without a key", async () => {
    expect((await t.fetch("/track", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await t.fetch("/top?name=e&dimension=d", { method: "GET" })).status).toBe(401);
    expect((await t.fetch("/timeseries?name=e", { method: "GET" })).status).toBe(401);
  });
});

describe("POST /track", () => {
  let t: ReturnType<typeof initConvexTest>;
  beforeEach(async () => {
    t = initConvexTest();
    await withKey(t);
  });

  it("tracks an event and returns 201", async () => {
    const res = await t.fetch("/track", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "signup", subjectRef: "u1", sessionRef: "s1",
        props: { plan: "pro" }, ts: D(1), dedupeKey: "k1",
        dimensions: ["plan"], granularities: ["day"], sampleRate: 1,
      }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ result: "tracked" });
    expect(await t.query(api.queries.metric, { scope: "default", name: "signup" })).toBe(1);
  });

  it("defaults granularities to [day] when omitted", async () => {
    const res = await t.fetch("/track", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "e", dimensions: [] }),
    });
    expect(res.status).toBe(201);
  });

  it("400s on invalid JSON", async () => {
    const res = await t.fetch("/track", { method: "POST", headers: auth, body: "{not json" });
    expect(res.status).toBe(400);
  });

  it("400s when name is missing", async () => {
    const res = await t.fetch("/track", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ dimensions: [] }),
    });
    expect(res.status).toBe(400);
  });

  it("400s when dimensions is missing", async () => {
    const res = await t.fetch("/track", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "e" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET query endpoints", () => {
  let t: ReturnType<typeof initConvexTest>;
  beforeEach(async () => {
    t = initConvexTest();
    await withKey(t);
    await t.mutation(api.mutations.track, {
      scope: "default", name: "view", subjectRef: "u1", props: { plan: "pro" },
      ts: D(1), dimensions: ["plan"], granularities: ["hour", "day"],
    });
  });

  it("/metric returns the total, and a where-filtered count", async () => {
    const res = await t.fetch("/metric?name=view", { headers: auth });
    expect((await res.json()).count).toBe(1);
    const filtered = await t.fetch("/metric?name=view&dim=plan&val=pro", { headers: auth });
    expect((await filtered.json()).count).toBe(1);
  });

  it("/metric 400s without name", async () => {
    const res = await t.fetch("/metric", { headers: auth });
    expect(res.status).toBe(400);
  });

  it("/top returns a breakdown (with and without limit), 400 without dimension or name", async () => {
    const res = await t.fetch("/top?name=view&dimension=plan&limit=5", { headers: auth });
    expect(await res.json()).toEqual([{ value: "pro", count: 1 }]);
    const noLimit = await t.fetch("/top?name=view&dimension=plan", { headers: auth });
    expect(await noLimit.json()).toEqual([{ value: "pro", count: 1 }]);
    expect((await t.fetch("/top?name=view", { headers: auth })).status).toBe(400);
    expect((await t.fetch("/top?dimension=plan", { headers: auth })).status).toBe(400);
  });

  it("/timeseries returns buckets, 400 on bad granularity or missing name", async () => {
    const res = await t.fetch("/timeseries?name=view&granularity=day&from=" + D(1), { headers: auth });
    const points = await res.json();
    expect(points[0].count).toBe(1);
    expect((await t.fetch("/timeseries?name=view&granularity=year", { headers: auth })).status).toBe(400);
    expect((await t.fetch("/timeseries?granularity=day", { headers: auth })).status).toBe(400);
  });

  it("/uniques returns DAU/WAU/MAU, 400 on bad granularity", async () => {
    const res = await t.fetch("/uniques?granularity=day&from=" + D(1) + "&to=" + D(2), { headers: auth });
    expect((await res.json()).mau).toBe(1);
    expect((await t.fetch("/uniques?granularity=year", { headers: auth })).status).toBe(400);
  });

  it("/timeseries and /uniques default the range to {} when no from/to given", async () => {
    const ts = await t.fetch("/timeseries?name=view&granularity=day", { headers: auth });
    expect(ts.status).toBe(200);
    const u = await t.fetch("/uniques?granularity=day", { headers: auth });
    expect(u.status).toBe(200);
  });

  it("/timeseries and /uniques default granularity to day when the param is absent", async () => {
    const ts = await t.fetch("/timeseries?name=view", { headers: auth });
    expect(ts.status).toBe(200);
    const u = await t.fetch("/uniques", { headers: auth });
    expect(u.status).toBe(200);
  });

  it("/metric accepts a to-only range (from absent)", async () => {
    const res = await t.fetch("/metric?name=view&to=" + D(5), { headers: auth });
    expect(res.status).toBe(200);
  });

  it("/uniques 401s without a key", async () => {
    expect((await t.fetch("/uniques?granularity=day", { method: "GET" })).status).toBe(401);
  });

  it("/metric ignores a half-specified where (dim without val)", async () => {
    const res = await t.fetch("/metric?name=view&dim=plan", { headers: auth });
    expect((await res.json()).count).toBe(1);
  });
});
