/**
 * Web analytics, end to end: a real browser loads the example site, the tracker posts to the
 * gateway, the gateway forwards a reduced event to Umami.
 *
 * Claims checked on the running stack:
 * - the page view is counted by Umami for that website;
 * - the visitor's address is stored nowhere and logged nowhere;
 * - the query string, the page title and the language are not stored;
 * - the page sets no cookie and writes nothing to device storage.
 */
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EXAMPLE_SITE_URL, GATEWAY_URL, UMAMI_DB, eventually, everythingKept, query, runId } from "../support/stack.ts";
import { adminToken, createWebsite, stats } from "../support/umami-admin.ts";

/** A documentation address (RFC 5737): it belongs to nobody, and is easy to search for. */
const VISITOR_IP = "203.0.113.77";

/**
 * An ordinary browser's user agent. Headless Chromium announces itself as "HeadlessChrome", which
 * Umami's bot check refuses (see the last test of this file).
 */
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

let browser: Browser;
let admin: string;

beforeAll(async () => {
  browser = await chromium.launch();
  admin = await adminToken();
});
afterAll(async () => {
  await browser?.close();
});

describe("a page view from a real browser", () => {
  it("is counted, and leaves no address, query string, title or device storage behind", async () => {
    const websiteId = await createWebsite(admin, `web-${runId()}`);
    const secret = randomUUID();

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "fr-FR",
      viewport: { width: 1512, height: 982 },
      screen: { width: 1512, height: 982 },
    });
    const page = await context.newPage();

    // The test stands in for the proxy in front of the gateway: it adds the visitor's address to
    // the event request, as a load balancer would.
    const sent: string[] = [];
    await page.route(`${GATEWAY_URL}/v1/e`, async (route) => {
      const request = route.request();
      if (request.method() === "POST") sent.push(request.postData() ?? "");
      await route.continue({ headers: { ...request.headers(), "x-forwarded-for": VISITOR_IP } });
    });

    const posted = page.waitForResponse((res) => res.url() === `${GATEWAY_URL}/v1/e` && res.request().method() === "POST");
    await page.goto(`${EXAMPLE_SITE_URL}/?website=${websiteId}&host=${encodeURIComponent(GATEWAY_URL)}&email=${secret}@example.org`);
    const response = await posted;
    expect(response.status()).toBe(200);

    // What the stock tracker sent, before the gateway reduced it: it does carry the title, the
    // language and the query string.
    expect(sent).toHaveLength(1);
    const original = JSON.parse(sent[0]!).payload;
    expect(original.title).toBe("Example site: static HTML");
    expect(original.language).toBe("fr-FR");
    expect(original.url).toContain(secret);

    // Counted by Umami.
    const totals = await eventually(async () => {
      const res = await stats(admin, websiteId);
      return res.status === 200 && res.body.pageviews >= 1 ? res.body : undefined;
    }, "the page view in Umami's stats");
    expect(totals).toMatchObject({ pageviews: 1, visitors: 1, visits: 1 });

    // Stored: the path, the browser family, a screen class. Not stored: query, title, language.
    const [event] = await query<{ url_path: string; url_query: string | null; page_title: string | null; hostname: string | null }>(
      UMAMI_DB,
      "SELECT url_path, url_query, page_title, hostname FROM website_event WHERE website_id = $1",
      [websiteId],
    );
    expect(event).toMatchObject({ url_path: "/" });
    expect(event!.url_query ?? "").toBe("");
    expect(event!.page_title ?? "").toBe("");
    const [session] = await query<{ browser: string; screen: string; language: string | null; country: string | null }>(
      UMAMI_DB,
      "SELECT browser, screen, language, country FROM session WHERE website_id = $1",
      [websiteId],
    );
    expect(session).toMatchObject({ browser: "chrome", screen: "1366x768" });
    expect(session!.language ?? "").toBe("");

    // Nothing kept on the device.
    expect(await context.cookies()).toEqual([]);
    expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });

    // The address and the value from the query string are in no table and in no log.
    const kept = everythingKept();
    expect(kept).not.toContain(VISITOR_IP);
    expect(kept).not.toContain(secret);

    await context.close();
  });

  it("counts a second view by the same visitor as a page view, not as a new visitor", async () => {
    const websiteId = await createWebsite(admin, `web-${runId()}`);
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    await page.route(`${GATEWAY_URL}/v1/e`, (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": "198.51.100.23" } }));

    // The same visitor loads the page twice.
    for (let view = 0; view < 2; view++) {
      const posted = page.waitForResponse((res) => res.url() === `${GATEWAY_URL}/v1/e` && res.request().method() === "POST");
      await page.goto(`${EXAMPLE_SITE_URL}/?website=${websiteId}&host=${encodeURIComponent(GATEWAY_URL)}`);
      expect((await posted).status()).toBe(200);
    }

    const totals = await eventually(async () => {
      const res = await stats(admin, websiteId);
      return res.status === 200 && res.body.pageviews >= 2 ? res.body : undefined;
    }, "two page views");
    expect(totals).toMatchObject({ pageviews: 2, visitors: 1 });
    await context.close();
  });

  it("is not counted when the browser announces itself as automated", async () => {
    const websiteId = await createWebsite(admin, `web-${runId()}`);
    // No user agent override: headless Chromium says "HeadlessChrome".
    const context = await browser.newContext();
    const page = await context.newPage();
    const posted = page.waitForResponse((res) => res.url() === `${GATEWAY_URL}/v1/e` && res.request().method() === "POST");
    await page.goto(`${EXAMPLE_SITE_URL}/?website=${websiteId}&host=${encodeURIComponent(GATEWAY_URL)}`);
    const response = await posted;
    expect(await page.evaluate(() => navigator.userAgent)).toContain("HeadlessChrome");
    // The gateway answers normally, with no token: a bot learns nothing from the response.
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({});
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect((await stats(admin, websiteId)).body.pageviews).toBe(0);
    await context.close();
  });
});

describe("what the gateway refuses", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${GATEWAY_URL}/v1/e`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("ignores an address, a user agent or a salt supplied in the event", async () => {
    const websiteId = await createWebsite(admin, `web-${runId()}`);
    const claimed = "192.0.2.199";
    const res = await post(
      { type: "event", payload: { website: websiteId, url: "/", ip: claimed, userAgent: "claimed-agent", salt: "claimed-salt", id: "claimed-id" } },
      { "x-forwarded-for": "198.51.100.77", "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0" },
    );
    expect(res.status).toBe(200);
    await eventually(async () => (await stats(admin, websiteId)).body.pageviews >= 1, "the page view");

    const [session] = await query<{ browser: string; distinct_id: string | null }>(UMAMI_DB, "SELECT browser, distinct_id FROM session WHERE website_id = $1", [websiteId]);
    expect(session).toMatchObject({ browser: "firefox" });
    expect(session!.distinct_id ?? "").toBe("");
    const kept = everythingKept();
    for (const value of [claimed, "198.51.100.77", "claimed-agent", "claimed-salt", "claimed-id"]) expect(kept).not.toContain(value);
  });

  it("refuses custom events, identification and anything that is not a page view", async () => {
    const websiteId = await createWebsite(admin, `web-${runId()}`);
    expect((await post({ type: "event", payload: { website: websiteId, url: "/", name: "signup", data: { plan: "pro" } } })).status).toBe(400);
    expect((await post({ type: "identify", payload: { website: websiteId, data: { email: "a@b.c" } } })).status).toBe(400);
    expect((await post({ type: "event", payload: { url: "/" } })).status).toBe(400);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect((await stats(admin, websiteId)).body.pageviews).toBe(0);
  });
});
