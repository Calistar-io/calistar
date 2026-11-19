/**
 * Public entry point for web events.
 *
 * The browser's request stops here. What goes on to Umami is a new request built from an
 * allow-list: the page path, the referrer's origin, a coarse screen class, the truncated client
 * address and a salt that changes every day. Umami never sees the full address, the query string,
 * the page title, the language or any custom data.
 *
 * Proof-of-concept limits: the tracker is Umami's stock script, served through this gateway, and
 * the origin of an event is not checked against a verified domain yet.
 */
import { randomBytes } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";

import { clientIp, truncateIp } from "./ip.ts";

/** Neutral public names: they must not match ad-block filter lists. Final names are not chosen. */
export const SCRIPT_PATH = "/s/v0.js";
export const EVENT_PATH = "/v1/e";

const MAX_EVENT_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOSTNAME = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/i;

/** Request headers the stock tracker sends: the preflight must allow them. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-umami-cache, x-umami-website-id, x-umami-hostname",
  "access-control-max-age": "86400",
};

/**
 * A random value mixed into Umami's visitor hash, replaced every UTC day. It lives in this
 * process's memory only: once replaced, yesterday's hashes cannot be recomputed from an address
 * and a user agent. With several gateway replicas the salt has to be shared (secret manager).
 */
export class DailySalt {
  private day = "";
  private value = "";

  current(now: Date = new Date()): string {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.value = randomBytes(32).toString("hex");
    }
    return this.value;
  }
}

/** Reduces a screen size to one of a few classes, so it cannot help single out a device. */
export function screenClass(screen: unknown): string | undefined {
  const match = typeof screen === "string" ? /^(\d{2,5})x(\d{2,5})$/.exec(screen) : null;
  if (!match) return undefined;
  const width = Number(match[1]);
  if (width < 600) return "360x800";
  if (width < 1024) return "768x1024";
  if (width < 1600) return "1366x768";
  return "1920x1080";
}

/** The path of a URL, without query string or fragment. */
export function pathOnly(url: unknown): string | undefined {
  if (typeof url !== "string" || url.length > 2048) return undefined;
  try {
    return new URL(url, "https://placeholder.invalid").pathname;
  } catch {
    return undefined;
  }
}

/** The origin of a referrer (scheme and host): which site sent the visitor, not which page. */
export function referrerOrigin(referrer: unknown): string | undefined {
  if (typeof referrer !== "string" || referrer === "" || referrer.length > 2048) return undefined;
  try {
    const url = new URL(referrer);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

export interface ForwardedEvent {
  type: "event";
  payload: {
    website: string;
    hostname?: string;
    url: string;
    referrer?: string;
    screen?: string;
    ip?: string;
    salt: string;
  };
}

/**
 * Builds the event sent to Umami, or `undefined` when the body is not a page view for a website.
 * Only the fields named here exist in the result: a field the caller adds, `ip` and `userAgent`
 * included, is not copied.
 */
export function buildEvent(body: unknown, ip: string | undefined, salt: string): ForwardedEvent | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const { type, payload } = body as { type?: unknown; payload?: unknown };
  if (type !== "event" || typeof payload !== "object" || payload === null) return undefined;
  const input = payload as Record<string, unknown>;

  if (typeof input.website !== "string" || !UUID.test(input.website)) return undefined;
  // A named event is a custom event: not collected in this version.
  if (input.name !== undefined && input.name !== "") return undefined;
  const url = pathOnly(input.url);
  if (url === undefined) return undefined;

  const event: ForwardedEvent = { type: "event", payload: { website: input.website.toLowerCase(), url, salt } };
  if (typeof input.hostname === "string" && HOSTNAME.test(input.hostname)) event.payload.hostname = input.hostname.toLowerCase();
  const referrer = referrerOrigin(input.referrer);
  if (referrer) event.payload.referrer = referrer;
  const screen = screenClass(input.screen);
  if (screen) event.payload.screen = screen;
  if (ip) event.payload.ip = ip;
  return event;
}

export interface WebEventsOptions {
  umamiUrl: string;
  /** Proxies in front of the gateway that append to `X-Forwarded-For`. 0: the TCP peer is the client. */
  trustedProxyHops: number;
  salt?: DailySalt;
  fetch?: typeof fetch;
  /** Address of the TCP peer. Replaced in unit tests, where there is no socket. */
  socketAddress?: (c: Context) => string | undefined;
}

export function webEvents({
  umamiUrl,
  trustedProxyHops,
  salt = new DailySalt(),
  fetch: doFetch = fetch,
  socketAddress = (c) => getConnInfo(c).remote.address,
}: WebEventsOptions): Hono {
  const app = new Hono();

  // The tracker script. Stock Umami script for now; the reduced, hash-pinned build replaces it.
  app.get(SCRIPT_PATH, async (c) => {
    const upstream = await doFetch(`${umamiUrl}/script.js`).catch(() => undefined);
    if (!upstream?.ok) return c.text("tracker unavailable", 502);
    return new Response(upstream.body, {
      headers: {
        "content-type": "application/javascript; charset=utf-8",
        "cache-control": "public, max-age=3600",
        "access-control-allow-origin": "*",
      },
    });
  });

  app.options(EVENT_PATH, () => new Response(null, { status: 204, headers: CORS_HEADERS }));

  app.post(
    EVENT_PATH,
    bodyLimit({ maxSize: MAX_EVENT_BYTES, onError: (c) => c.json({ error: "payload too large" }, 413, CORS_HEADERS) }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "body is not JSON" }, 400, CORS_HEADERS);
      }

      // The full address is read here and truncated on the same line. It is never logged or forwarded.
      const ip = truncateIp(clientIp(socketAddress(c), c.req.header("x-forwarded-for"), trustedProxyHops));
      const event = buildEvent(body, ip, salt.current());
      if (!event) return c.json({ error: "not a page view" }, 400, CORS_HEADERS);

      const headers = new Headers({ "content-type": "application/json" });
      const userAgent = c.req.header("user-agent");
      if (userAgent) headers.set("user-agent", userAgent.slice(0, 512));
      // Umami's own token, which lets it skip a lookup on the next event of the same page.
      const cache = c.req.header("x-umami-cache");
      if (cache && cache.length <= 2048) headers.set("x-umami-cache", cache);

      let upstream: Response;
      try {
        upstream = await doFetch(`${umamiUrl}/api/send`, { method: "POST", headers, body: JSON.stringify(event) });
      } catch {
        return c.json({ error: "collection temporarily unavailable" }, 503, CORS_HEADERS);
      }
      if (!upstream.ok) {
        const status = upstream.status >= 400 && upstream.status < 500 ? 400 : 502;
        return c.json({ error: "event refused" }, status, CORS_HEADERS);
      }
      // Only the cache token goes back: the tracker keeps it in memory for the life of the page.
      const result = (await upstream.json().catch(() => ({}))) as { cache?: unknown };
      return c.json(typeof result.cache === "string" ? { cache: result.cache } : {}, 200, CORS_HEADERS);
    },
  );

  return app;
}
