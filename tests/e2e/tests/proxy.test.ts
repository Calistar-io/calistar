/**
 * The reverse proxy: what is reachable from outside, and what is not.
 *
 * The base stack publishes the proxy only. It forwards ingestion to the gateway, and of Umami
 * only what a read-only dashboard needs. Everything else gets a 404 from the proxy itself.
 *
 * Claims checked on the running stack:
 * - ingestion works through the proxy, and a caller cannot choose the address the gateway sees;
 * - the dashboard works through the proxy, every route it calls being published;
 * - Umami's collection endpoints, tracker script and sign-in are not reachable;
 * - nothing that writes reaches Umami, including the API-key route recorded in sso.test.ts.
 */
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { histogramExport } from "../support/otlp.ts";
import { PROXY_URL, UMAMI_DB, eventually, query, runId, TOKEN_A } from "../support/stack.ts";
import { adminToken, createWebsite, provisionTenant, signIn, stats, type Tenant } from "../support/umami-admin.ts";

let browser: Browser;
let admin: string;
let tenant: Tenant;
let token: string;

beforeAll(async () => {
  browser = await chromium.launch();
  admin = await adminToken();
  tenant = await provisionTenant(admin, `proxy-${runId()}`);
  token = await signIn(tenant.username, tenant.password);
});
afterAll(async () => {
  await browser?.close();
});

/** A request through the proxy, as anyone on the internet could send it. */
const through = (method: string, path: string, init: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  fetch(`${PROXY_URL}${path}`, {
    method,
    headers: {
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe("ingestion through the proxy", () => {
  it("reaches the gateway", async () => {
    const body = histogramExport([{ attrs: { "http.request.method": "GET", "http.route": `/${runId()}/via-proxy`, "http.response.status_code": 200 }, count: 1 }]);
    expect((await through("POST", "/v1/metrics", { body })).status).toBe(401);
    expect((await through("POST", "/v1/metrics", { body, token: TOKEN_A })).status).toBe(200);
    expect((await through("GET", "/s/v0.js")).status).toBe(200);
    expect((await through("OPTIONS", "/v1/e")).status).toBe(204);
  });

  it("does not let the caller choose the address the gateway sees", async () => {
    const websiteId = await createWebsite(admin, `proxy-${runId()}`);
    // A public address with a known country. If the proxy passed it on as the client address,
    // Umami would store that country for the session.
    const res = await through("POST", "/v1/e", {
      body: { type: "event", payload: { website: websiteId, url: "/" } },
      headers: { "x-forwarded-for": "81.2.69.160", "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0" },
    });
    expect(res.status).toBe(200);
    await eventually(async () => (await stats(admin, websiteId)).body.pageviews >= 1, "the page view");
    const [session] = await query<{ country: string | null }>(UMAMI_DB, "SELECT country FROM session WHERE website_id = $1", [websiteId]);
    // The proxy saw a local address, which has no country.
    expect(session!.country ?? "").toBe("");
  });
});

describe("the dashboard through the proxy", () => {
  it("opens from a token, and every API route it calls is published", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const refused: string[] = [];
    page.on("response", (res) => {
      const url = new URL(res.url());
      if (url.pathname.startsWith("/api/") && res.status() >= 400) refused.push(`${res.request().method()} ${url.pathname} ${res.status()}`);
    });

    const base = `/websites/${tenant.websiteId}`;
    await page.goto(`${PROXY_URL}/sso?token=${encodeURIComponent(token)}&url=${encodeURIComponent(base)}`);
    await page.waitForURL(`**${base}**`);
    await expect.poll(() => page.locator("body").innerText(), { timeout: 20_000 }).toContain(tenant.name);
    for (const tab of ["events", "sessions", "realtime", "compare"]) {
      await page.goto(`${PROXY_URL}${base}/${tab}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
    }
    expect(refused).toEqual([]);
    expect(await page.locator('input[type="password"]').count()).toBe(0);
    await context.close();
  });

  it("serves the tenant's numbers", async () => {
    const now = Date.now();
    const res = await through("GET", `/api/websites/${tenant.websiteId}/stats?startAt=${now - 3_600_000}&endAt=${now}`, { token });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pageviews: 0 });
  });
});

describe("what the proxy does not publish", () => {
  const website = "0f7d1c2e-4b5a-4c6d-8e9f-a1b2c3d4e5f6";

  it.each([
    ["Umami's collection endpoint", "POST", "/api/send", { type: "event", payload: { website, url: "/", ip: "8.8.8.8" } }],
    ["Umami's batch collection endpoint", "POST", "/api/batch", [{ type: "event", payload: { website, url: "/" } }]],
    ["Umami's stock tracker script", "GET", "/script.js", undefined],
    ["Umami's recorder script", "GET", "/recorder.js", undefined],
    ["Umami's sign-in page", "GET", "/login", undefined],
    ["Umami's sign-in route", "POST", "/api/auth/login", { username: "admin", password: "umami" }],
    ["Umami's single sign-on token route", "POST", "/api/auth/sso", {}],
    ["the gateway's health check", "GET", "/healthz", undefined],
    ["Umami's health check", "GET", "/api/heartbeat", undefined],
    ["the administration pages", "GET", "/admin/users", undefined],
    ["the settings pages", "GET", "/settings/profile", undefined],
  ])("%s", async (_name, method, path, body) => {
    const res = await through(method, path, { body });
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("anything that writes, even with a valid token", async () => {
    const site = `/api/websites/${tenant.websiteId}`;
    const attempts: [string, string, unknown?][] = [
      ["POST", "/api/me/api-keys", { name: "kept" }],
      ["POST", "/api/me/password", { currentPassword: "x", newPassword: "another-long-password" }],
      ["POST", site, { name: "renamed", domain: "evil.example.org" }],
      ["POST", `${site}/reset`],
      ["DELETE", site],
      ["POST", "/api/websites", { name: "mine", domain: "mine.example.org" }],
      ["POST", "/api/teams", { name: "mine" }],
      ["POST", "/api/teams/join", { accessCode: "team_0000000000000000" }],
      ["DELETE", `/api/teams/${tenant.teamId}/users/${tenant.userId}`],
      ["POST", `/api/users/${tenant.userId}`, { role: "admin" }],
      ["POST", "/api/reports/funnel", {}],
    ];
    for (const [method, path, body] of attempts) {
      const res = await through(method, path, { token, body });
      expect(`${method} ${path} ${res.status}`).toBe(`${method} ${path} 404`);
    }
  });

  it("routes that read other things than the tenant's dashboard", async () => {
    for (const path of ["/api/me", "/api/me/api-keys", "/api/users", "/api/admin/users", "/api/admin/websites", "/api/teams", `/api/teams/${tenant.teamId}`, "/api/websites"]) {
      const res = await through("GET", path, { token: admin });
      expect(`${path} ${res.status}`).toBe(`${path} 404`);
    }
  });
});
