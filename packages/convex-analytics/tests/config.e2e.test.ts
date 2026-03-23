/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import { api } from "../src/component/_generated/api.js";
import schema from "../src/component/schema.js";

const modules = import.meta.glob("../src/component/**/*.ts");

function initTest() {
  return convexTest(schema, modules);
}

describe("config.get", () => {
  it("returns the value for an existing key", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("config", { key: "retention_days", value: "90" });
    });

    const result = await t.query(api.queries.configGet, { key: "retention_days" });
    expect(result).toBe("90");
  });

  it("returns null for a non-existent key", async () => {
    const t = initTest();

    const result = await t.query(api.queries.configGet, { key: "does_not_exist" });
    expect(result).toBeNull();
  });
});

describe("config.getAll", () => {
  it("returns all config entries", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("config", { key: "retention_days", value: "90" });
      await ctx.db.insert("config", { key: "rate_limit", value: "100" });
    });

    const result = await t.query(api.queries.configGetAll, {});
    expect(result).toEqual({
      retention_days: "90",
      rate_limit: "100",
    });
  });

  it("masks api_keys value", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("config", {
        key: "api_keys",
        value: JSON.stringify(["key1", "key2", "key3"]),
      });
      await ctx.db.insert("config", { key: "retention_days", value: "30" });
    });

    const result = await t.query(api.queries.configGetAll, {});
    expect(result).toEqual({
      api_keys: "[3 keys configured]",
      retention_days: "30",
    });
  });
});

describe("config.set", () => {
  it("inserts a new config key", async () => {
    const t = initTest();

    const result = await t.mutation(api.mutations.configSet, {
      key: "retention_days",
      value: "90",
    });
    expect(result).toBeNull();

    const value = await t.query(api.queries.configGet, { key: "retention_days" });
    expect(value).toBe("90");
  });

  it("updates an existing config key", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("config", { key: "retention_days", value: "30" });
    });

    await t.mutation(api.mutations.configSet, {
      key: "retention_days",
      value: "90",
    });

    const value = await t.query(api.queries.configGet, { key: "retention_days" });
    expect(value).toBe("90");
  });
});

describe("config.setMany", () => {
  it("sets multiple mutable keys at once", async () => {
    const t = initTest();

    const result = await t.mutation(api.mutations.configSetMany, {
      entries: {
        retention_days: "60",
        rate_limit: "200",
        session_timeout: "1800",
      },
    });
    expect(result).toBeNull();

    const all = await t.query(api.queries.configGetAll, {});
    expect(all).toEqual({
      retention_days: "60",
      rate_limit: "200",
      session_timeout: "1800",
    });
  });

  it("throws when setting an immutable key", async () => {
    const t = initTest();

    await expect(
      t.mutation(api.mutations.configSetMany, { entries: { api_keys: "bad" } }),
    ).rejects.toThrow("not mutable");
  });
});

describe("config.listSchemas", () => {
  it("returns all event schemas", async () => {
    const t = initTest();

    await t.run(async (ctx) => {
      await ctx.db.insert("event_schemas", {
        name: "page_view",
        allowedProperties: { url: "string", duration: "number" },
      });
      await ctx.db.insert("event_schemas", {
        name: "signup",
        allowedProperties: { plan: "string" },
      });
    });

    const schemas = await t.query(api.queries.configListSchemas, {});
    expect(schemas).toHaveLength(2);
    expect(schemas.map((s: { name: string }) => s.name).sort()).toEqual([
      "page_view",
      "signup",
    ]);
  });

  it("returns empty array when no schemas exist", async () => {
    const t = initTest();

    const schemas = await t.query(api.queries.configListSchemas, {});
    expect(schemas).toHaveLength(0);
  });
});

describe("config.upsertSchema", () => {
  it("creates a new schema", async () => {
    const t = initTest();

    const result = await t.mutation(api.mutations.configUpsertSchema, {
      name: "click",
      allowedProperties: { target: "string", x: "number", y: "number" },
    });
    expect(result).toBeNull();

    const schemas = await t.query(api.queries.configListSchemas, {});
    expect(schemas).toHaveLength(1);
    expect(schemas[0].name).toBe("click");
    expect(schemas[0].allowedProperties).toEqual({
      target: "string",
      x: "number",
      y: "number",
    });
  });

  it("updates an existing schema", async () => {
    const t = initTest();

    await t.mutation(api.mutations.configUpsertSchema, {
      name: "click",
      allowedProperties: { target: "string" },
    });

    await t.mutation(api.mutations.configUpsertSchema, {
      name: "click",
      allowedProperties: { target: "string", enabled: "boolean" },
    });

    const schemas = await t.query(api.queries.configListSchemas, {});
    expect(schemas).toHaveLength(1);
    expect(schemas[0].allowedProperties).toEqual({
      target: "string",
      enabled: "boolean",
    });
  });

  it("throws on invalid property type", async () => {
    const t = initTest();

    await expect(
      t.mutation(api.mutations.configUpsertSchema, {
        name: "test",
        allowedProperties: { x: "invalid" },
      }),
    ).rejects.toThrow("must be 'string', 'number', or 'boolean'");
  });
});
