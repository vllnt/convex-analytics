import { httpAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

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

async function requireApiKey(
  ctx: { runQuery: (ref: never, args: never) => Promise<unknown> },
  request: Request,
): Promise<Response | null> {
  const key = request.headers.get("x-api-key");
  if (!key) {
    return error("Missing x-api-key header", 401);
  }
  const config = await ctx.runQuery(api.config.get as never, { key: "api_keys" } as never);
  if (!config) {
    return error("API keys not configured", 401);
  }
  const keys = JSON.parse(config as string) as string[];
  const matched = keys.some((stored) => timingSafeEqual(stored, key));
  if (!matched) {
    return error("Invalid API key", 401);
  }
  return null;
}

function parseJsonSafe(request: Request): Promise<{ ok: true; data: unknown } | { ok: false }> {
  return request.json().then(
    (data) => ({ ok: true as const, data }),
    () => ({ ok: false as const }),
  );
}

function getSearchParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

const EVENT_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

export const trackEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const parsed = await parseJsonSafe(request);
  if (!parsed.ok) return error("Invalid JSON body");
  const body = parsed.data as Record<string, unknown>;

  if (!body["userId"] || !body["sessionId"] || !body["name"]) {
    return error("userId, sessionId, and name are required");
  }
  const name = String(body["name"]);
  if (!EVENT_NAME_RE.test(name)) {
    return error("name must match /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/");
  }

  const ua = request.headers.get("User-Agent") ?? "";

  await ctx.runMutation(api.track.track as never, {
    userId: String(body["userId"]),
    sessionId: String(body["sessionId"]),
    name,
    projectId: body["projectId"] != null ? String(body["projectId"]) : undefined,
    env: body["env"] != null ? String(body["env"]) : undefined,
    platform: body["platform"] != null ? String(body["platform"]) : undefined,
    properties: body["properties"] ?? undefined,
    timestamp: typeof body["timestamp"] === "number" ? body["timestamp"] : undefined,
    path: body["path"] != null ? String(body["path"]) : undefined,
    locale: body["locale"] != null ? String(body["locale"]) : undefined,
    referrer: body["referrer"] != null ? String(body["referrer"]) : undefined,
    device: body["device"] != null ? String(body["device"]) : parseDevice(ua),
    browser: body["browser"] != null ? String(body["browser"]) : parseBrowser(ua),
    os: body["os"] != null ? String(body["os"]) : parseOS(ua),
    country: body["country"] != null
      ? String(body["country"])
      : request.headers.get("X-Vercel-IP-Country")
        ?? request.headers.get("CF-IPCountry")
        ?? undefined,
    region: body["region"] != null
      ? String(body["region"])
      : request.headers.get("X-Vercel-IP-Country-Region") ?? undefined,
    city: body["city"] != null
      ? String(body["city"])
      : request.headers.get("X-Vercel-IP-City") ?? undefined,
    utmSource: body["utmSource"] != null ? String(body["utmSource"]) : undefined,
    utmMedium: body["utmMedium"] != null ? String(body["utmMedium"]) : undefined,
    utmCampaign: body["utmCampaign"] != null ? String(body["utmCampaign"]) : undefined,
  } as never);

  return json({ ok: true }, 201);
});

export const eventsEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const name = params.get("name");
  if (!name) return error("name parameter required");

  const result = await ctx.runQuery(api.queries.list as never, {
    name,
    projectId: params.get("projectId") ?? undefined,
    env: params.get("env") ?? undefined,
    platform: params.get("platform") ?? undefined,
    from: params.get("from") ? Number(params.get("from")) : undefined,
    to: params.get("to") ? Number(params.get("to")) : undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    cursor: params.get("cursor") ?? undefined,
  } as never);

  return json(result);
});

export const countEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const name = params.get("name");
  if (!name) return error("name parameter required");

  const count = await ctx.runQuery(api.queries.count as never, {
    name,
    from: params.get("from") ? Number(params.get("from")) : undefined,
    to: params.get("to") ? Number(params.get("to")) : undefined,
  } as never);

  return json({ name, count });
});

export const summaryEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const result = await ctx.runQuery(api.queries.summary as never, {
    projectId: params.get("projectId") ?? undefined,
  } as never);

  return json(result);
});

export const aliasEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const parsed = await parseJsonSafe(request);
  if (!parsed.ok) return error("Invalid JSON body");
  const body = parsed.data as Record<string, unknown>;

  if (!body["anonymousId"] || !body["identifiedId"]) {
    return error("anonymousId and identifiedId are required");
  }

  await ctx.runMutation(api.track.alias as never, {
    anonymousId: String(body["anonymousId"]),
    identifiedId: String(body["identifiedId"]),
  } as never);

  return json({ ok: true });
});

export const schemasGetEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const schemas = await ctx.runQuery(api.config.listSchemas as never, {} as never);
  return json(schemas);
});

export const schemasPostEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const parsed = await parseJsonSafe(request);
  if (!parsed.ok) return error("Invalid JSON body");
  const body = parsed.data as Record<string, unknown>;

  if (!body["name"] || !body["allowedProperties"]) {
    return error("name and allowedProperties are required");
  }

  const props = body["allowedProperties"];
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    return error("allowedProperties must be an object { key: 'string'|'number'|'boolean' }");
  }
  for (const val of Object.values(props as Record<string, unknown>)) {
    if (val !== "string" && val !== "number" && val !== "boolean") {
      return error("allowedProperties values must be 'string', 'number', or 'boolean'");
    }
  }

  await ctx.runMutation(api.config.upsertSchema as never, {
    name: String(body["name"]),
    allowedProperties: props,
  } as never);

  return json({ ok: true });
});

export const configGetEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const config = await ctx.runQuery(api.config.getAll as never, {} as never) as Record<string, string>;
  const safe = { ...config };
  if ("api_keys" in safe) {
    const count = JSON.parse(safe["api_keys"]!).length;
    safe["api_keys"] = `[${count} keys configured]`;
  }
  return json(safe);
});

const MUTABLE_CONFIG_KEYS = new Set([
  "retention_days",
  "rate_limit",
  "session_timeout",
  "alert_threshold",
]);

export const configPatchEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const parsed = await parseJsonSafe(request);
  if (!parsed.ok) return error("Invalid JSON body");
  const body = parsed.data as Record<string, unknown>;

  const filtered: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!MUTABLE_CONFIG_KEYS.has(key)) {
      return error(`Config key '${key}' is not mutable. Allowed: ${[...MUTABLE_CONFIG_KEYS].join(", ")}`);
    }
    filtered[key] = String(value);
  }

  await ctx.runMutation(api.config.setMany as never, { entries: filtered } as never);
  return json({ ok: true });
});

// ─── Phase 2: Analytics Query Endpoints ───────────────────────────────────

export const timeseriesEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const name = params.get("name");
  if (!name) return error("name parameter required");
  const interval = params.get("interval") ?? "day";
  if (!["day", "week", "month"].includes(interval)) return error("interval must be day, week, or month");

  const result = await ctx.runQuery(api.queries.timeseries as never, {
    name,
    interval,
    projectId: params.get("projectId") ?? undefined,
    env: params.get("env") ?? undefined,
    from: params.get("from") ? Number(params.get("from")) : undefined,
    to: params.get("to") ? Number(params.get("to")) : undefined,
  } as never);

  return json(result);
});

export const funnelEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const stepsParam = params.get("steps");
  if (!stepsParam) return error("steps parameter required (comma-separated)");
  const steps = stepsParam.split(",").map((s) => s.trim());

  const result = await ctx.runQuery(api.queries.funnel as never, {
    steps,
    window: params.get("window") ?? undefined,
    from: params.get("from") ? Number(params.get("from")) : undefined,
    to: params.get("to") ? Number(params.get("to")) : undefined,
    projectId: params.get("projectId") ?? undefined,
  } as never);

  return json(result);
});

export const retentionEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const event = params.get("event");
  if (!event) return error("event parameter required");

  const result = await ctx.runQuery(api.queries.retention as never, {
    event,
    period: params.get("period") ?? undefined,
    cohorts: params.get("cohorts") ? Number(params.get("cohorts")) : undefined,
    projectId: params.get("projectId") ?? undefined,
  } as never);

  return json(result);
});

export const breakdownEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const name = params.get("name");
  const dimension = params.get("dimension") ?? params.get("by");
  if (!name) return error("name parameter required");
  if (!dimension) return error("dimension (or by) parameter required");

  const result = await ctx.runQuery(api.queries.breakdown as never, {
    name,
    dimension,
    from: params.get("from") ? Number(params.get("from")) : undefined,
    to: params.get("to") ? Number(params.get("to")) : undefined,
    projectId: params.get("projectId") ?? undefined,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  } as never);

  return json(result);
});

export const attributionEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const conversionEvent = params.get("event") ?? params.get("conversion_event");
  if (!conversionEvent) return error("event parameter required");

  const result = await ctx.runQuery(api.queries.attribution as never, {
    conversionEvent,
    from: params.get("from") ? Number(params.get("from")) : undefined,
    to: params.get("to") ? Number(params.get("to")) : undefined,
    projectId: params.get("projectId") ?? undefined,
  } as never);

  return json(result);
});

export const userEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const userId = params.get("id");
  if (!userId) return error("id parameter required");

  const result = await ctx.runQuery(api.queries.userTimeline as never, {
    userId,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  } as never);

  return json(result);
});

export const sessionEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const sessionId = params.get("id");
  if (!sessionId) return error("id parameter required");

  const result = await ctx.runQuery(api.queries.sessionDetail as never, {
    sessionId,
  } as never);

  return json(result);
});

export const liveEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const result = await ctx.runQuery(api.queries.live as never, {
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    projectId: params.get("projectId") ?? undefined,
  } as never);

  return json(result);
});

export const searchEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const q = params.get("q");
  if (!q) return error("q parameter required");

  const result = await ctx.runQuery(api.queries.search as never, {
    query: q,
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  } as never);

  return json(result);
});

export const uniquesEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const period = params.get("period") ?? "day";
  if (!["day", "week", "month"].includes(period)) return error("period must be day, week, or month");

  const result = await ctx.runQuery(api.queries.uniques as never, {
    period,
    from: params.get("from") ? Number(params.get("from")) : undefined,
    to: params.get("to") ? Number(params.get("to")) : undefined,
    projectId: params.get("projectId") ?? undefined,
  } as never);

  return json(result);
});

export const lifecycleEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const result = await ctx.runQuery(api.queries.lifecycle as never, {
    period: params.get("period") ?? undefined,
    from: params.get("from") ? Number(params.get("from")) : undefined,
    to: params.get("to") ? Number(params.get("to")) : undefined,
    projectId: params.get("projectId") ?? undefined,
  } as never);

  return json(result);
});

export const stickinessEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const result = await ctx.runQuery(api.queries.stickiness as never, {
    from: params.get("from") ? Number(params.get("from")) : undefined,
    to: params.get("to") ? Number(params.get("to")) : undefined,
    projectId: params.get("projectId") ?? undefined,
  } as never);

  return json(result);
});

// ─── Phase 3: GDPR Deletion Endpoint ─────────────────────────────────────

export const deleteUserEndpoint = httpAction(async (ctx, request) => {
  const authError = await requireApiKey(ctx, request);
  if (authError) return authError;

  const params = getSearchParams(request);
  const userId = params.get("id");
  if (!userId) return error("id parameter required");

  await ctx.runMutation(internal.crons.deleteUser as never, ({ userId }) as never);
  return json({ ok: true, deleted: userId });
});

function parseBrowser(ua: string): string {
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
  return "Other";
}

function parseOS(ua: string): string {
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("Mac OS X") || ua.includes("Macintosh")) return "macOS";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("Linux")) return "Linux";
  return "Other";
}

function parseDevice(ua: string): string {
  if (/bot|crawler|spider/i.test(ua)) return "bot";
  if (/iPhone|Android.*Mobile/i.test(ua)) return "mobile";
  if (/iPad|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  return "desktop";
}
