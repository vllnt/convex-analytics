import { describe, it, expect, vi } from "vitest";
import type { Scalar } from "../src/shared.js";
import {
  webDimensions,
  parseUserAgent,
  geoFromHeaders,
  trackPageview,
} from "../src/web/index.js";

const CHROME =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
const FIREFOX =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
const EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/604.1";
const ANDROID_PHONE =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const BOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";
const LINUX_GENERIC = "Mozilla/5.0 (X11; Linux x86_64) Gecko";

describe("web preset — webDimensions", () => {
  it("is the standard web rollup dimension list", () => {
    expect(webDimensions).toEqual([
      "path",
      "referrer",
      "device",
      "browser",
      "os",
      "country",
      "utmSource",
      "utmMedium",
      "utmCampaign",
    ]);
  });
});

describe("web preset — parseUserAgent", () => {
  it("buckets browsers", () => {
    expect(parseUserAgent(CHROME).browser).toBe("Chrome");
    expect(parseUserAgent(FIREFOX).browser).toBe("Firefox");
    expect(parseUserAgent(EDGE).browser).toBe("Edge");
    expect(parseUserAgent(SAFARI).browser).toBe("Safari");
    expect(parseUserAgent("nonsense").browser).toBe("Other");
  });

  it("buckets operating systems", () => {
    expect(parseUserAgent(FIREFOX).os).toBe("Windows");
    expect(parseUserAgent(SAFARI).os).toBe("macOS");
    expect(parseUserAgent(IPHONE).os).toBe("iOS");
    expect(parseUserAgent(ANDROID_PHONE).os).toBe("Android");
    expect(parseUserAgent(LINUX_GENERIC).os).toBe("Linux");
    expect(parseUserAgent("nonsense").os).toBe("Other");
  });

  it("buckets devices", () => {
    expect(parseUserAgent(BOT).device).toBe("bot");
    expect(parseUserAgent(IPHONE).device).toBe("mobile");
    expect(parseUserAgent(ANDROID_PHONE).device).toBe("mobile");
    expect(parseUserAgent(IPAD).device).toBe("tablet");
    expect(parseUserAgent(ANDROID_TABLET).device).toBe("tablet");
    expect(parseUserAgent(CHROME).device).toBe("desktop");
  });
});

describe("web preset — geoFromHeaders", () => {
  it("reads Vercel geo headers from a plain record (case-insensitive)", () => {
    const geo = geoFromHeaders({
      "X-Vercel-IP-Country": "US",
      "x-vercel-ip-country-region": "CA",
      "X-Vercel-IP-City": "San Francisco",
    });
    expect(geo).toEqual({ country: "US", region: "CA", city: "San Francisco" });
  });

  it("reads Cloudflare country from a Headers instance and omits absent fields", () => {
    const headers = new Headers({ "CF-IPCountry": "FR" });
    expect(geoFromHeaders(headers)).toEqual({ country: "FR" });
  });

  it("prefers CF-IPCountry over the Vercel country header", () => {
    const geo = geoFromHeaders({
      "CF-IPCountry": "DE",
      "X-Vercel-IP-Country": "US",
    });
    expect(geo.country).toBe("DE");
  });

  it("defaults country to 'unknown' when no geo header is present", () => {
    expect(geoFromHeaders({})).toEqual({ country: "unknown" });
  });
});

interface Captured {
  ctx: unknown;
  name: string;
  opts: {
    subjectRef?: string;
    sessionRef?: string;
    props?: Record<string, Scalar>;
    ts?: number;
    scope?: string;
    dedupeKey?: string;
  };
}

function fakeClient() {
  const calls: Captured[] = [];
  const track = vi.fn(
    async (ctx: unknown, name: string, opts: Captured["opts"]) => {
      calls.push({ ctx, name, opts });
      return "tracked" as const;
    },
  );
  return { client: { track }, calls };
}

describe("web preset — trackPageview", () => {
  it("builds full web props from ua + headers + utm and forwards refs", async () => {
    const { client, calls } = fakeClient();
    const ctx = { marker: true };
    const result = await trackPageview(client, ctx, {
      subjectRef: "u1",
      sessionRef: "s1",
      path: "/pricing",
      referrer: "https://google.com",
      ua: ANDROID_PHONE,
      headers: { "X-Vercel-IP-Country": "US", "X-Vercel-IP-City": "NYC" },
      utm: { source: "newsletter", medium: "email", campaign: "launch" },
      ts: 123,
      scope: "web",
      dedupeKey: "dk",
    });

    expect(result).toBe("tracked");
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.ctx).toBe(ctx);
    expect(call.name).toBe("page_view");
    expect(call.opts).toEqual({
      subjectRef: "u1",
      sessionRef: "s1",
      ts: 123,
      scope: "web",
      dedupeKey: "dk",
      props: {
        path: "/pricing",
        referrer: "https://google.com",
        device: "mobile",
        browser: "Chrome",
        os: "Android",
        country: "US",
        city: "NYC",
        utmSource: "newsletter",
        utmMedium: "email",
        utmCampaign: "launch",
      },
    });
  });

  it("omits ua/geo/utm props and optional refs when not provided", async () => {
    const { client, calls } = fakeClient();
    await trackPageview(client, {}, { path: "/" });
    expect(calls[0]!.opts).toEqual({ props: { path: "/" } });
  });

  it("includes region when the geo header carries it", async () => {
    const { client, calls } = fakeClient();
    await trackPageview(client, {}, {
      path: "/x",
      headers: { "CF-IPCountry": "GB", "X-Vercel-IP-Country-Region": "ENG" },
    });
    expect(calls[0]!.opts.props).toEqual({
      path: "/x",
      country: "GB",
      region: "ENG",
    });
  });

  it("adds only the utm keys that are set", async () => {
    const { client, calls } = fakeClient();
    await trackPageview(client, {}, { path: "/x", utm: { source: "x" } });
    expect(calls[0]!.opts.props).toEqual({ path: "/x", utmSource: "x" });
  });
});
