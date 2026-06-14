/**
 * Optional web preset for `@vllnt/convex-analytics`.
 *
 * Pure, host-side helpers — NOT part of the sandboxed component. A web host
 * opts in by passing {@link webDimensions} to the `AnalyticsClient` `dimensions`
 * config and using {@link trackPageview} to ingest page views. The generic core
 * stays domain-neutral; nothing here runs inside the component sandbox.
 *
 * @packageDocumentation
 */

import type { Scalar } from "../shared.js";

/**
 * Standard web rollup dimensions. Pass to the `AnalyticsClient` `dimensions`
 * config to opt into web breakdowns (path, referrer, device, browser, ...).
 */
export const webDimensions = [
  "path",
  "referrer",
  "device",
  "browser",
  "os",
  "country",
  "utmSource",
  "utmMedium",
  "utmCampaign",
] as const;

/** A key of {@link webDimensions}. */
export type WebDimension = (typeof webDimensions)[number];

/** Parsed user-agent facets. */
export interface UserAgentInfo {
  device: string;
  browser: string;
  os: string;
}

/** Geo facets resolved from edge/CDN request headers. */
export interface GeoInfo {
  country: string;
  region?: string;
  city?: string;
}

/** UTM campaign tags. */
export interface Utm {
  source?: string;
  medium?: string;
  campaign?: string;
}

function browserOf(ua: string): string {
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
  return "Other";
}

function osOf(ua: string): string {
  if (ua.includes("Windows")) return "Windows";
  if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
  if (ua.includes("Android")) return "Android";
  if (ua.includes("Mac OS X") || ua.includes("Macintosh")) return "macOS";
  if (ua.includes("Linux")) return "Linux";
  return "Other";
}

function deviceOf(ua: string): string {
  if (/bot|crawler|spider/i.test(ua)) return "bot";
  if (/iPhone|Android.*Mobile/i.test(ua)) return "mobile";
  if (/iPad|Android(?!.*Mobile)/i.test(ua)) return "tablet";
  return "desktop";
}

/**
 * Parse a `User-Agent` string into device / browser / os facets.
 *
 * Pure and dependency-free — coarse buckets suitable for rollups, not exact
 * version detection. Unknown agents fall back to `"Other"` / `"desktop"`.
 *
 * @param ua - The raw `User-Agent` header value.
 * @returns Device, browser, and OS buckets.
 * @example
 * ```ts
 * parseUserAgent("Mozilla/5.0 ... Chrome/120 Safari/537");
 * // { device: "desktop", browser: "Chrome", os: "..." }
 * ```
 */
export function parseUserAgent(ua: string): UserAgentInfo {
  return { device: deviceOf(ua), browser: browserOf(ua), os: osOf(ua) };
}

function headerGetter(
  headers: Headers | Record<string, string>,
): (name: string) => string | undefined {
  if (typeof (headers as Headers).get === "function") {
    return (name) => (headers as Headers).get(name) ?? undefined;
  }
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as Record<string, string>)) {
    lower[k.toLowerCase()] = v;
  }
  return (name) => lower[name.toLowerCase()];
}

/**
 * Resolve geo facets from Cloudflare / Vercel edge request headers.
 *
 * Reads `CF-IPCountry` and the `X-Vercel-IP-*` family. Accepts either a DOM
 * `Headers` instance or a plain object (case-insensitive). Country defaults to
 * `"unknown"` when no header is present.
 *
 * @param headers - Request headers as a `Headers` instance or a plain record.
 * @returns Country (always present) plus optional region / city.
 */
export function geoFromHeaders(headers: Headers | Record<string, string>): GeoInfo {
  const get = headerGetter(headers);
  const country =
    get("CF-IPCountry") ?? get("X-Vercel-IP-Country") ?? "unknown";
  const region = get("X-Vercel-IP-Country-Region");
  const city = get("X-Vercel-IP-City");
  const info: GeoInfo = { country };
  if (region !== undefined) info.region = region;
  if (city !== undefined) info.city = city;
  return info;
}

/** A subset of the `AnalyticsClient` surface used by {@link trackPageview}. */
interface PageviewClient {
  track(
    ctx: unknown,
    name: string,
    opts: {
      subjectRef?: string;
      sessionRef?: string;
      props?: Record<string, Scalar>;
      ts?: number;
      scope?: string;
      dedupeKey?: string;
    },
  ): Promise<unknown>;
}

/** Options for {@link trackPageview}. */
export interface TrackPageviewOpts {
  subjectRef?: string;
  sessionRef?: string;
  /** The page path (e.g. `/pricing`). */
  path: string;
  /** The document referrer, if any. */
  referrer?: string;
  /** Raw `User-Agent` header — parsed into device/browser/os when present. */
  ua?: string;
  /** Request headers — parsed for geo (country/region/city) when present. */
  headers?: Headers | Record<string, string>;
  /** UTM campaign tags. */
  utm?: Utm;
  /** Epoch-millis event time. Defaults to the component's clock when omitted. */
  ts?: number;
  /** Override the client's default scope for this event. */
  scope?: string;
  /** Skip if an event with this dedupe key already exists in the scope. */
  dedupeKey?: string;
}

/**
 * Build web `props` from a pageview (parsing UA + geo) and ingest a
 * `"page_view"` event through the generic `AnalyticsClient`.
 *
 * Host-side convenience: the component never sees web concepts — this helper
 * just assembles the `{@link webDimensions}`-shaped props and calls
 * `client.track(ctx, "page_view", { props })`. Pair with
 * `dimensions: webDimensions` on the client to get web rollups.
 *
 * @typeParam C - The `AnalyticsClient` (structural) type.
 * @param client - An `AnalyticsClient` (or compatible) instance.
 * @param ctx - The Convex mutation ctx to run `track` against.
 * @param opts - Pageview fields; `path` is required.
 * @returns The `track` result passed through from the client.
 * @example
 * ```ts
 * const analytics = new AnalyticsClient(components.analytics, { dimensions: webDimensions });
 * await trackPageview(analytics, ctx, {
 *   path: "/pricing",
 *   ua: request.headers.get("user-agent") ?? undefined,
 *   headers: request.headers,
 * });
 * ```
 */
export async function trackPageview<C extends PageviewClient>(
  client: C,
  ctx: unknown,
  opts: TrackPageviewOpts,
): Promise<unknown> {
  const ua = opts.ua !== undefined ? parseUserAgent(opts.ua) : undefined;
  const geo = opts.headers !== undefined ? geoFromHeaders(opts.headers) : undefined;

  const props: Record<string, Scalar> = { path: opts.path };
  if (opts.referrer !== undefined) props["referrer"] = opts.referrer;
  if (ua !== undefined) {
    props["device"] = ua.device;
    props["browser"] = ua.browser;
    props["os"] = ua.os;
  }
  if (geo !== undefined) {
    props["country"] = geo.country;
    if (geo.region !== undefined) props["region"] = geo.region;
    if (geo.city !== undefined) props["city"] = geo.city;
  }
  if (opts.utm?.source !== undefined) props["utmSource"] = opts.utm.source;
  if (opts.utm?.medium !== undefined) props["utmMedium"] = opts.utm.medium;
  if (opts.utm?.campaign !== undefined) props["utmCampaign"] = opts.utm.campaign;

  const trackOpts: {
    subjectRef?: string;
    sessionRef?: string;
    props: Record<string, Scalar>;
    ts?: number;
    scope?: string;
    dedupeKey?: string;
  } = { props };
  if (opts.subjectRef !== undefined) trackOpts.subjectRef = opts.subjectRef;
  if (opts.sessionRef !== undefined) trackOpts.sessionRef = opts.sessionRef;
  if (opts.ts !== undefined) trackOpts.ts = opts.ts;
  if (opts.scope !== undefined) trackOpts.scope = opts.scope;
  if (opts.dedupeKey !== undefined) trackOpts.dedupeKey = opts.dedupeKey;

  return client.track(ctx, "page_view", trackOpts);
}
