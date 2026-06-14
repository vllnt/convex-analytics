import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
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
  const keys = JSON.parse(config as string) as string[];
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

function range(params: URLSearchParams): { from?: number; to?: number } | undefined {
  const from = params.get("from");
  const to = params.get("to");
  if (from === null && to === null) return undefined;
  return {
    from: from !== null ? Number(from) : undefined,
    to: to !== null ? Number(to) : undefined,
  };
}

export const trackEndpoint = httpAction(async (ctx, request) => {
  const parsed = await parseJsonSafe(request);
  if (!parsed.ok) return error("Invalid JSON body");
  const body = parsed.data as Record<string, unknown>;

  const scope = scopeOf(body["scope"]);
  const authError = await requireApiKey(ctx, request, scope);
  if (authError) return authError;

  if (typeof body["name"] !== "string" || body["name"].length === 0) {
    return error("name is required");
  }
  if (!Array.isArray(body["dimensions"])) {
    return error("dimensions (string[]) is required");
  }

  const result = await ctx.runMutation(api.mutations.track as never, {
    scope,
    name: body["name"],
    subjectRef: typeof body["subjectRef"] === "string" ? body["subjectRef"] : undefined,
    sessionRef: typeof body["sessionRef"] === "string" ? body["sessionRef"] : undefined,
    props: body["props"] ?? undefined,
    ts: typeof body["ts"] === "number" ? body["ts"] : undefined,
    dedupeKey: typeof body["dedupeKey"] === "string" ? body["dedupeKey"] : undefined,
    dimensions: body["dimensions"],
    granularities: Array.isArray(body["granularities"]) ? body["granularities"] : ["day"],
    sampleRate: typeof body["sampleRate"] === "number" ? body["sampleRate"] : undefined,
  } as never);

  return json({ result }, 201);
});

export const metricEndpoint = httpAction(async (ctx, request) => {
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

export const topEndpoint = httpAction(async (ctx, request) => {
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
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  } as never);

  return json(result);
});

export const timeseriesEndpoint = httpAction(async (ctx, request) => {
  const params = getParams(request);
  const scope = scopeOf(params.get("scope"));
  const authError = await requireApiKey(ctx, request, scope);
  if (authError) return authError;

  const name = params.get("name");
  if (!name) return error("name parameter required");
  const granularity = params.get("granularity") ?? "day";
  if (granularity !== "hour" && granularity !== "day") {
    return error("granularity must be hour or day");
  }

  const result = await ctx.runQuery(api.queries.timeseries as never, {
    scope,
    name,
    granularity,
    range: range(params) ?? {},
  } as never);

  return json(result);
});

export const uniquesEndpoint = httpAction(async (ctx, request) => {
  const params = getParams(request);
  const scope = scopeOf(params.get("scope"));
  const authError = await requireApiKey(ctx, request, scope);
  if (authError) return authError;

  const granularity = params.get("granularity") ?? "day";
  if (granularity !== "hour" && granularity !== "day") {
    return error("granularity must be hour or day");
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
