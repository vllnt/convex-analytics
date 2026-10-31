import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { httpAction } from "./_generated/server.js";
import type { ActionCtx } from "./_generated/server.js";
import { assertProps } from "./validators.js";
import { api } from "./_generated/api.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/**
 * Run a handler body and turn a typed input error from the component (a `ConvexError`
 * with `{ code, message }`) into `400 { error, code }`. Anything else still fails the action.
 */
export async function withInputErrors(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (e) {
    const data: unknown = e instanceof ConvexError ? e.data : undefined;
    if (typeof data === "object" && data !== null && "code" in data && "message" in data) {
      return json({ error: String(data.message), code: String(data.code) }, 400);
    }
    throw e;
  }
}

/** An `httpAction` whose typed input errors are returned as 400 responses. */
function handle(fn: (ctx: ActionCtx, request: Request) => Promise<Response>) {
  return httpAction((ctx, request) => withInputErrors(() => fn(ctx, request)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

function scopeOf(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "default";
}

/** The stored `apiKeys` value as a string array, or `null` when it is not one. */
function parseApiKeys(raw: string): string[] | null {
  try {
    const keys: unknown = JSON.parse(raw);
    return Array.isArray(keys) && keys.every((k) => typeof k === "string") ? keys : null;
  } catch {
    return null;
  }
}

/**
 * Gate a request by API key. Keys are a JSON string array stored at config
 * `(scope, "apiKeys")`. Returns an error Response on failure, else null.
 */
async function requireApiKey(
  ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
  request: Request,
  scope: string,
): Promise<Response | null> {
  const key = request.headers.get("x-api-key");
  if (!key) return error("Missing x-api-key header", 401);
  const config = await ctx.runQuery(api.queries.configGet as never, {
    scope,
    key: "apiKeys",
  } as never);
  if (!config) return error("API keys not configured", 401);
  const keys = parseApiKeys(config as string);
  if (keys === null) return error("API keys misconfigured", 500);
  const matched = keys.some((stored) => timingSafeEqual(stored, key));
  if (!matched) return error("Invalid API key", 401);
  return null;
}

function parseJsonSafe(
  request: Request,
): Promise<{ ok: true; data: unknown } | { ok: false }> {
  return request.json().then(
    (data) => ({ ok: true as const, data }),
    () => ({ ok: false as const }),
  );
}

function getParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

/** A numeric query param; blank or malformed values become NaN so the component rejects them. */
function numberParam(params: URLSearchParams, name: string): number | undefined {
  const raw = params.get(name);
  if (raw === null) return undefined;
  return raw.trim() === "" ? NaN : Number(raw);
}

function range(params: URLSearchParams): { from?: number; to?: number } | undefined {
  const from = numberParam(params, "from");
  const to = numberParam(params, "to");
  if (from === undefined && to === undefined) return undefined;
  return { from, to };
}

const GRANULARITIES = ["minute", "hour", "day"];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export const trackEndpoint = handle(async (ctx, request) => {
  const parsed = await parseJsonSafe(request);
  if (!parsed.ok) return error("Invalid JSON body");
  if (typeof parsed.data !== "object" || parsed.data === null || Array.isArray(parsed.data)) {
    return error("Body must be a JSON object");
  }
  const body = parsed.data as Record<string, unknown>;

  const scope = scopeOf(body["scope"]);
  const authError = await requireApiKey(ctx, request, scope);
  if (authError) return authError;

  if (typeof body["name"] !== "string" || body["name"].length === 0) {
    return error("name is required");
  }
  if (!isStringArray(body["dimensions"])) {
    return error("dimensions (string[]) is required");
  }
  const props = body["props"] ?? undefined;
  if (props !== undefined && (typeof props !== "object" || Array.isArray(props))) {
    return error("props must be a flat object of scalar values");
  }
  if (props !== undefined) assertProps(props as Record<string, unknown>);
  const granularities = body["granularities"] ?? ["day"];
  if (!isStringArray(granularities) || !granularities.every((g) => GRANULARITIES.includes(g))) {
    return error("granularities must be an array of minute, hour, or day");
  }

  const result = await ctx.runMutation(api.mutations.track as never, {
    scope,
    name: body["name"],
    subjectRef: typeof body["subjectRef"] === "string" ? body["subjectRef"] : undefined,
    sessionRef: typeof body["sessionRef"] === "string" ? body["sessionRef"] : undefined,
    props,
    ts: typeof body["ts"] === "number" ? body["ts"] : undefined,
    dedupeKey: typeof body["dedupeKey"] === "string" ? body["dedupeKey"] : undefined,
    dimensions: body["dimensions"],
    granularities,
    sampleRate: typeof body["sampleRate"] === "number" ? body["sampleRate"] : undefined,
  } as never);

  return json({ result }, 201);
});

export const metricEndpoint = handle(async (ctx, request) => {
  const params = getParams(request);
  const scope = scopeOf(params.get("scope"));
  const authError = await requireApiKey(ctx, request, scope);
  if (authError) return authError;

  const name = params.get("name");
  if (!name) return error("name parameter required");
  const dim = params.get("dim");
  const val = params.get("val");

  const count = await ctx.runQuery(api.queries.metric as never, {
    scope,
    name,
    range: range(params),
    where: dim !== null && val !== null ? { dim, val } : undefined,
  } as never);

  return json({ name, count });
});

export const topEndpoint = handle(async (ctx, request) => {
  const params = getParams(request);
  const scope = scopeOf(params.get("scope"));
  const authError = await requireApiKey(ctx, request, scope);
  if (authError) return authError;

  const name = params.get("name");
  const dimension = params.get("dimension");
  if (!name) return error("name parameter required");
  if (!dimension) return error("dimension parameter required");

  const result = await ctx.runQuery(api.queries.top as never, {
    scope,
    name,
    dimension,
    range: range(params),
    limit: numberParam(params, "limit"),
  } as never);

  return json(result);
});

export const timeseriesEndpoint = handle(async (ctx, request) => {
  const params = getParams(request);
  const scope = scopeOf(params.get("scope"));
  const authError = await requireApiKey(ctx, request, scope);
  if (authError) return authError;

  const name = params.get("name");
  if (!name) return error("name parameter required");
  const granularity = params.get("granularity") ?? "day";
  if (!GRANULARITIES.includes(granularity)) {
    return error("granularity must be minute, hour, or day");
  }

  const result = await ctx.runQuery(api.queries.timeseries as never, {
    scope,
    name,
    granularity,
    range: range(params) ?? {},
  } as never);

  return json(result);
});

export const uniquesEndpoint = handle(async (ctx, request) => {
  const params = getParams(request);
  const scope = scopeOf(params.get("scope"));
  const authError = await requireApiKey(ctx, request, scope);
  if (authError) return authError;

  const granularity = params.get("granularity") ?? "day";
  if (!GRANULARITIES.includes(granularity)) {
    return error("granularity must be minute, hour, or day");
  }

  const result = await ctx.runQuery(api.queries.uniques as never, {
    scope,
    granularity,
    range: range(params) ?? {},
  } as never);

  return json(result);
});

/**
 * Lean generic HTTP surface. Routes are namespaced under the host's chosen
 * `httpPrefix` when the component is mounted with one. All routes require an
 * `x-api-key` matching the JSON-array config at `(scope, "apiKeys")`.
 */
const http = httpRouter();
http.route({ path: "/track", method: "POST", handler: trackEndpoint });
http.route({ path: "/metric", method: "GET", handler: metricEndpoint });
http.route({ path: "/top", method: "GET", handler: topEndpoint });
http.route({ path: "/timeseries", method: "GET", handler: timeseriesEndpoint });
http.route({ path: "/uniques", method: "GET", handler: uniquesEndpoint });

export default http;
