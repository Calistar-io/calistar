import { describe, expect, it } from "vitest";

import { clientIp, truncateIp } from "../src/ip.ts";
import { buildEvent, DailySalt, EVENT_PATH, pathOnly, referrerOrigin, SCRIPT_PATH, screenClass, webEvents } from "../src/web-events.ts";

const WEBSITE = "0f7d1c2e-4b5a-4c6d-8e9f-a1b2c3d4e5f6";

describe("truncateIp", () => {
  it.each([
    ["203.0.113.77", "203.0.113.0"],
    ["8.8.8.8", "8.8.8.0"],
    ["2001:db8:85a3:8d3:1319:8a2e:370:7348", "2001:db8:85a3::"],
    ["2001:db8::1", "2001:db8:0::"],
    ["::1", "0:0:0::"],
    ["::ffff:203.0.113.77", "203.0.113.0"],
    ["[2001:db8:85a3::8a2e:370:7334]", "2001:db8:85a3::"],
    ["fe80::1%eth0", "fe80:0:0::"],
  ])("%s -> %s", (input, expected) => {
    expect(truncateIp(input)).toBe(expected);
  });

  it.each([undefined, "", "not-an-ip", "203.0.113", "203.0.113.77.1", "1.2.3.4, 5.6.7.8", "12345::1"])("returns nothing for %s", (input) => {
    expect(truncateIp(input)).toBeUndefined();
  });

  it("never returns the last octet or the interface part", () => {
    for (let i = 1; i < 255; i += 7) {
      expect(truncateIp(`198.51.100.${i}`)).toBe("198.51.100.0");
      expect(truncateIp(`2001:db8:1:2:${i.toString(16)}:aaaa:bbbb:cccc`)).toBe("2001:db8:1::");
    }
  });
});

describe("clientIp", () => {
  it("ignores X-Forwarded-For when no proxy is trusted", () => {
    expect(clientIp("10.0.0.5", "203.0.113.77", 0)).toBe("10.0.0.5");
  });

  it("takes the entry the trusted proxy appended, not what the caller sent", () => {
    // The caller sends "1.1.1.1"; the one trusted proxy appends the address it saw.
    expect(clientIp("10.0.0.5", "1.1.1.1, 203.0.113.77", 1)).toBe("203.0.113.77");
    expect(clientIp("10.0.0.5", "1.1.1.1, 203.0.113.77, 10.0.0.9", 2)).toBe("203.0.113.77");
  });

  it("falls back to the TCP peer when the header is missing or too short", () => {
    expect(clientIp("10.0.0.5", undefined, 1)).toBe("10.0.0.5");
    expect(clientIp("10.0.0.5", "203.0.113.77", 2)).toBe("10.0.0.5");
  });
});

describe("field reduction", () => {
  it("keeps the path of a URL only", () => {
    expect(pathOnly("/pricing?utm_source=x&email=a@b.c#top")).toBe("/pricing");
    expect(pathOnly("https://example.org/a/b?token=secret")).toBe("/a/b");
    expect(pathOnly("")).toBe("/");
    expect(pathOnly(42)).toBeUndefined();
  });

  it("keeps the origin of a referrer only", () => {
    expect(referrerOrigin("https://news.example.com/item?id=123&user=me")).toBe("https://news.example.com");
    expect(referrerOrigin("")).toBeUndefined();
    expect(referrerOrigin("javascript:alert(1)")).toBeUndefined();
    expect(referrerOrigin("/relative")).toBeUndefined();
  });

  it("reduces a screen size to a class", () => {
    expect(screenClass("390x844")).toBe("360x800");
    expect(screenClass("820x1180")).toBe("768x1024");
    expect(screenClass("1440x900")).toBe("1366x768");
    expect(screenClass("3840x2160")).toBe("1920x1080");
    expect(screenClass("wide")).toBeUndefined();
  });
});

describe("buildEvent", () => {
  const full = {
    type: "event",
    payload: {
      website: WEBSITE.toUpperCase(),
      hostname: "Example.org",
      url: "/account/settings?email=someone@example.org",
      referrer: "https://search.example/?q=private+query",
      screen: "1512x982",
      title: "Settings for someone@example.org",
      language: "fr-FR",
      ip: "203.0.113.77",
      userAgent: "spoofed",
      browser: "x",
      os: "y",
      device: "z",
      id: "user-42",
      tag: "campaign",
      data: { email: "someone@example.org" },
      salt: "caller-salt",
      timestamp: 1,
    },
  };

  it("forwards the allow-listed fields and nothing else", () => {
    const event = buildEvent(full, "198.51.100.0", "daily-salt");
    expect(event).toEqual({
      type: "event",
      payload: {
        website: WEBSITE,
        hostname: "example.org",
        url: "/account/settings",
        referrer: "https://search.example",
        screen: "1366x768",
        ip: "198.51.100.0",
        salt: "daily-salt",
      },
    });
    expect(JSON.stringify(event)).not.toMatch(/someone|private|spoofed|203\.0\.113\.77|user-42|caller-salt|fr-FR/);
  });

  it("omits the address when the gateway could not read one, and never takes the caller's", () => {
    const event = buildEvent(full, undefined, "s");
    expect(event?.payload.ip).toBeUndefined();
  });

  it.each([
    ["no body", null],
    ["another type", { type: "identify", payload: { website: WEBSITE, url: "/" } }],
    ["an error report", { type: "error", payload: { website: WEBSITE, url: "/" } }],
    ["a custom event", { type: "event", payload: { website: WEBSITE, url: "/", name: "signup" } }],
    ["no website", { type: "event", payload: { url: "/" } }],
    ["a website that is not a UUID", { type: "event", payload: { website: "x' or 1=1", url: "/" } }],
    ["a link instead of a website", { type: "event", payload: { link: WEBSITE, url: "/" } }],
    ["no URL", { type: "event", payload: { website: WEBSITE } }],
  ])("refuses %s", (_name, body) => {
    expect(buildEvent(body, "198.51.100.0", "s")).toBeUndefined();
  });
});

describe("DailySalt", () => {
  it("is stable within a UTC day and replaced the next day", () => {
    const salt = new DailySalt();
    const a = salt.current(new Date("2026-11-19T00:00:01Z"));
    expect(salt.current(new Date("2026-11-19T23:59:59Z"))).toBe(a);
    const b = salt.current(new Date("2026-11-20T00:00:00Z"));
    expect(b).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(new DailySalt().current(new Date("2026-11-19T12:00:00Z"))).not.toBe(a);
  });
});

describe("web events route", () => {
  interface Call {
    url: string;
    headers: Headers;
    body: string;
  }
  function umami(response: () => Response = () => Response.json({ cache: "cache-token", sessionId: "s", visitId: "v" })) {
    const calls: Call[] = [];
    const fake: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body ?? "") });
      return response();
    };
    return { calls, fake };
  }
  const app = (fake: typeof fetch, hops = 0, peer = "203.0.113.77") =>
    webEvents({ umamiUrl: "http://umami:3000", trustedProxyHops: hops, fetch: fake, socketAddress: () => peer });

  const send = (a: ReturnType<typeof app>, body: unknown, headers: Record<string, string> = {}) =>
    a.request(EVENT_PATH, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  const pageView = { type: "event", payload: { website: WEBSITE, url: "/docs?x=1", hostname: "example.org", ip: "9.9.9.9" } };

  it("sends Umami the truncated address of the TCP peer, not the caller's claims", async () => {
    const { calls, fake } = umami();
    const res = await send(app(fake), pageView, {
      "x-forwarded-for": "1.2.3.4",
      "x-real-ip": "1.2.3.4",
      "user-agent": "Mozilla/5.0 test",
      cookie: "a=b",
      "x-umami-cache": "previous-token",
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cache: "cache-token" });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("http://umami:3000/api/send");
    const sent = JSON.parse(call.body);
    expect(sent.payload.ip).toBe("203.0.113.0");
    expect(sent.payload.url).toBe("/docs");
    expect(sent.payload.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(call.body).not.toMatch(/203\.0\.113\.77|1\.2\.3\.4|9\.9\.9\.9/);
    expect([...call.headers.keys()].sort()).toEqual(["content-type", "user-agent", "x-umami-cache"]);
  });

  it("uses X-Forwarded-For only for the hops it is told to trust", async () => {
    const { calls, fake } = umami();
    await send(app(fake, 1, "10.0.0.9"), pageView, { "x-forwarded-for": "1.2.3.4, 198.51.100.200" });
    expect(JSON.parse(calls[0]!.body).payload.ip).toBe("198.51.100.0");
  });

  it("refuses what is not a page view, without calling Umami", async () => {
    const { calls, fake } = umami();
    const a = app(fake);
    expect((await send(a, { type: "identify", payload: { website: WEBSITE } })).status).toBe(400);
    expect((await a.request(EVENT_PATH, { method: "POST", body: "{not json" })).status).toBe(400);
    expect((await send(a, { type: "event", payload: { website: WEBSITE, url: "/", data: "x".repeat(20000) } })).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("returns nothing when Umami answers a bot, and an error when Umami refuses or is down", async () => {
    const bot = umami(() => Response.json({ beep: "boop" }));
    expect(await (await send(app(bot.fake), pageView)).json()).toEqual({});

    const refused = umami(() => Response.json({ message: "Website not found." }, { status: 400 }));
    expect((await send(app(refused.fake), pageView)).status).toBe(400);

    const down: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect((await send(app(down), pageView)).status).toBe(503);
  });

  it("answers the browser's preflight and serves the tracker script from Umami", async () => {
    const { calls, fake } = umami(() => new Response("/* tracker */", { headers: { "content-type": "application/javascript" } }));
    const a = app(fake);

    const preflight = await a.request(EVENT_PATH, { method: "OPTIONS" });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-headers")).toContain("x-umami-cache");

    const script = await a.request(SCRIPT_PATH);
    expect(script.status).toBe(200);
    expect(await script.text()).toBe("/* tracker */");
    expect(calls[0]!.url).toBe("http://umami:3000/script.js");
  });
});
