# Web preset reference

`@vllnt/convex-analytics/web` is an opt-in layer for web analytics: pure host-side helpers,
not part of the sandboxed component. The component's schema has no web fields; you turn on web
breakdowns by passing `webDimensions` to the client and ingesting page views with
`trackPageview`.

Source: `src/web/index.ts` in the package (`packages/convex-analytics/src/web/index.ts` in the
repository).

```ts
// convex/web.ts
import { AnalyticsClient } from "@vllnt/convex-analytics";
import { trackPageview, webDimensions } from "@vllnt/convex-analytics/web";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const analytics = new AnalyticsClient(components.analytics, {
  dimensions: [...webDimensions], // readonly tuple; `dimensions` takes a string[]
});

export const pageview = mutation({
  args: { path: v.string(), userAgent: v.optional(v.string()), utmSource: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, { path, userAgent, utmSource }) => {
    await trackPageview(analytics, ctx, { path, ua: userAgent, utm: { source: utmSource } });
    return null;
  },
});

export const byDevice = query({
  args: {},
  returns: v.array(v.object({ value: v.string(), count: v.number() })),
  handler: async (ctx) => await analytics.top(ctx, "page_view", "device"),
});
```

## webDimensions

```ts
// signature
const webDimensions: readonly ["path", "referrer", "device", "browser", "os", "country", "utmSource", "utmMedium", "utmCampaign"];
```

The nine props keys `trackPageview` writes and that are worth rolling up. Spread it into
`dimensions`. Not used unless you pass it.

## WebDimension

```ts
// signature
type WebDimension = (typeof webDimensions)[number];
```

## parseUserAgent

```ts
// signature
parseUserAgent(ua: string): UserAgentInfo
```

Coarse buckets by substring match, not version detection:

- `device`: `bot` (`bot`, `crawler`, `spider`), `mobile` (`iPhone`, `Android … Mobile`),
  `tablet` (`iPad`, other `Android`), else `desktop`.
- `browser`: `Firefox`, `Edge`, `Chrome`, `Safari`, else `Other`.
- `os`: `Windows`, `iOS`, `Android`, `macOS`, `Linux`, else `Other`.

## UserAgentInfo

```ts
// signature
interface UserAgentInfo { device: string; browser: string; os: string }
```

## geoFromHeaders

```ts
// signature
geoFromHeaders(headers: Headers | Record<string, string>): GeoInfo
```

Reads `CF-IPCountry` (Cloudflare), then `X-Vercel-IP-Country`, plus
`X-Vercel-IP-Country-Region` and `X-Vercel-IP-City`. Accepts a `Headers` instance or a plain
object (keys matched case-insensitively). `country` is `"unknown"` when no header is present.

## GeoInfo

```ts
// signature
interface GeoInfo { country: string; region?: string; city?: string }
```

## trackPageview

```ts
// signature
trackPageview(client: { track(ctx, name, opts): Promise<unknown> }, ctx, opts: TrackPageviewOpts): Promise<unknown>
```

`client` is usually an `AnalyticsClient`, but any object with a matching `track(ctx, name, opts)`
method works. Builds props and calls `client.track(ctx, "page_view", { props, ... })`, returning its result.
Props written: `path`; `referrer` when given; `device` / `browser` / `os` when `ua` is given;
`country` (and `region` / `city` when present) when `headers` is given; `utmSource` /
`utmMedium` / `utmCampaign` from `utm`. `region` and `city` are not in `webDimensions`, so they
are stored on the raw event but not rolled up unless you add them to `dimensions`. `ctx` needs
`runMutation`, so a mutation, action or HTTP action works.

## TrackPageviewOpts

```ts
// signature
interface TrackPageviewOpts {
  path: string;
  subjectRef?: string;
  sessionRef?: string;
  referrer?: string;
  ua?: string; // parsed into device / browser / os
  headers?: Headers | Record<string, string>; // parsed into country / region / city
  utm?: Utm;
  ts?: number;
  scope?: string;
  dedupeKey?: string;
}
```

## Utm

```ts
// signature
interface Utm { source?: string; medium?: string; campaign?: string }
```

## Privacy

`path`, `referrer` and the geo headers are stored as received. Strip tokens and personal data
from paths and referrers before calling `trackPageview`.
