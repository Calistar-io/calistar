/**
 * Provisioning and single sign-on into Umami, as the console will do it.
 *
 * A tenant never receives an Umami password. The console provisions a team, a website and a
 * view-only user, signs that user in on the server side, and sends the browser to Umami's `/sso`
 * page with the resulting token.
 *
 * Claims checked on the running stack, against Umami v3.5.0:
 * - the browser lands on the tenant's own dashboard, without a sign-in form;
 * - the tenant user can read its website and cannot edit, reset or delete it;
 * - it cannot read another tenant's website;
 * - a token stops working when the user's password is rotated.
 *
 * The last test records a gap that Umami alone does not close.
 */
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { UMAMI_URL, runId } from "../support/stack.ts";
import { adminToken, provisionTenant, rotatePassword, signIn, stats, umami, type Tenant } from "../support/umami-admin.ts";

const REFUSED = [401, 403];

let browser: Browser;
let admin: string;
let tenantA: Tenant;
let tenantB: Tenant;
let tokenA: string;

beforeAll(async () => {
  browser = await chromium.launch();
  admin = await adminToken();
  tenantA = await provisionTenant(admin, `tenant-a-${runId()}`, "a.example.org");
  tenantB = await provisionTenant(admin, `tenant-b-${runId()}`, "b.example.org");
  // Done by the console on the server side: the tenant never sees this password.
  tokenA = await signIn(tenantA.username, tenantA.password);
});
afterAll(async () => {
  await browser?.close();
});

describe("single sign-on", () => {
  it("opens the tenant's own dashboard from a token, without a sign-in form", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const target = `/websites/${tenantA.websiteId}`;

    const loaded = page.waitForResponse((res) => res.url().includes(`/api/websites/${tenantA.websiteId}`) && res.status() === 200);
    await page.goto(`${UMAMI_URL}/sso?token=${encodeURIComponent(tokenA)}&url=${encodeURIComponent(target)}`);
    await loaded;
    await page.waitForURL(`**${target}**`);

    expect(new URL(page.url()).pathname).toBe(target);
    await expect.poll(() => page.locator("body").innerText(), { timeout: 20_000 }).toContain(tenantA.name);
    expect(await page.locator('input[type="password"]').count()).toBe(0);
    await context.close();
  });

  /**
   * Not a claim: an observation. The reverse proxy will publish only the routes the dashboard
   * needs, so this prints which ones a view-only user's browser calls on the main pages. The
   * output feeds the allow-list.
   */
  it("records the routes the dashboard calls", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const origin = new URL(UMAMI_URL).origin;
    const seen = new Map<string, Set<number>>();
    page.on("response", (res) => {
      const url = new URL(res.url());
      if (url.origin !== origin) return;
      const path = url.pathname
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "{id}")
        .replace(/^\/_next\/.*/, "/_next/*")
        .replace(/^\/intl\/.*/, "/intl/*")
        .replace(/\.(png|svg|ico|json|webmanifest|woff2?)$/, ".<asset>");
      const key = `${res.request().method()} ${path}`;
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(res.status());
    });

    const base = `/websites/${tenantA.websiteId}`;
    await page.goto(`${UMAMI_URL}/sso?token=${encodeURIComponent(tokenA)}&url=${encodeURIComponent(base)}`);
    await page.waitForURL(`**${base}**`);
    await page.waitForLoadState("networkidle");
    for (const tab of ["events", "sessions", "realtime", "compare"]) {
      await page.goto(`${UMAMI_URL}${base}/${tab}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
    }
    await page.goto(`${UMAMI_URL}/websites`);
    await page.waitForLoadState("networkidle").catch(() => undefined);

    const lines = [...seen.entries()].map(([key, statuses]) => `${key}  [${[...statuses].sort().join(", ")}]`).sort();
    console.log(`Routes called by the dashboard (${lines.length}):\n${lines.join("\n")}`);
    expect(lines.some((line) => line.startsWith("GET /api/websites/{id}"))).toBe(true);
    await context.close();
  });

  it("refuses a redirect target outside Umami", async () => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${UMAMI_URL}/sso?token=${encodeURIComponent(tokenA)}&url=${encodeURIComponent("https://evil.example/")}`);
    await page.waitForTimeout(3000);
    expect(new URL(page.url()).origin).toBe(new URL(UMAMI_URL).origin);
    await context.close();
  });
});

describe("the tenant user can read and cannot change", () => {
  it("reads its own website and its numbers", async () => {
    expect((await umami("GET", `/api/websites/${tenantA.websiteId}`, tokenA)).status).toBe(200);
    expect((await stats(tokenA, tenantA.websiteId)).status).toBe(200);
  });

  it("cannot edit, reset or delete its website", async () => {
    const site = `/api/websites/${tenantA.websiteId}`;
    expect(REFUSED).toContain((await umami("POST", site, tokenA, { name: "renamed", domain: "evil.example.org" })).status);
    expect(REFUSED).toContain((await umami("POST", `${site}/reset`, tokenA)).status);
    expect(REFUSED).toContain((await umami("DELETE", site, tokenA)).status);

    // Still there, unchanged.
    const after = await umami<{ name: string; domain: string }>("GET", site, admin);
    expect(after.status).toBe(200);
    expect(after.body.domain).toBe("a.example.org");
  });

  it("cannot create a website, a team or a user", async () => {
    expect(REFUSED).toContain((await umami("POST", "/api/websites", tokenA, { name: "mine", domain: "mine.example.org" })).status);
    expect(REFUSED).toContain((await umami("POST", "/api/websites", tokenA, { name: "mine", domain: "mine.example.org", teamId: tenantA.teamId })).status);
    expect(REFUSED).toContain((await umami("POST", "/api/teams", tokenA, { name: "mine" })).status);
    expect(REFUSED).toContain((await umami("POST", "/api/users", tokenA, { username: `u${runId()}`, password: "long-enough-password", role: "admin" })).status);
  });

  it("cannot change its role, its username, its password or its team role", async () => {
    // Umami answers 200 to a user updating itself, and ignores every field an administrator
    // alone may set. What counts is that nothing changed.
    const self = await umami<{ role: string; username: string }>("POST", `/api/users/${tenantA.userId}`, tokenA, {
      role: "admin",
      username: "renamed-by-tenant",
      password: "chosen-by-the-tenant",
    });
    expect(self.body).toMatchObject({ role: "view-only", username: tenantA.username });
    const seenByAdmin = await umami<{ role: string; username: string }>("GET", `/api/users/${tenantA.userId}`, admin);
    expect(seenByAdmin.body).toMatchObject({ role: "view-only", username: tenantA.username });
    // The password the console holds still works, the one the tenant chose does not.
    await expect(signIn(tenantA.username, "chosen-by-the-tenant")).rejects.toThrow();
    await expect(signIn(tenantA.username, tenantA.password)).resolves.toBeTypeOf("string");

    expect(REFUSED).toContain((await umami("POST", `/api/teams/${tenantA.teamId}/users/${tenantA.userId}`, tokenA, { role: "team-manager" })).status);
    expect(REFUSED).toContain((await umami("POST", `/api/teams/${tenantA.teamId}`, tokenA, { name: "renamed" })).status);
  });

  it("cannot change its password without knowing it", async () => {
    const res = await umami("POST", "/api/me/password", tokenA, { currentPassword: "a-guess-that-is-wrong", newPassword: "another-long-password" });
    expect(res.status).toBe(400);
  });
});

describe("tenants are isolated inside Umami", () => {
  it("cannot read, list or change another tenant's website", async () => {
    const other = `/api/websites/${tenantB.websiteId}`;
    expect(REFUSED).toContain((await umami("GET", other, tokenA)).status);
    expect(REFUSED).toContain((await stats(tokenA, tenantB.websiteId)).status);
    expect(REFUSED).toContain((await umami("POST", `${other}/reset`, tokenA)).status);
    expect(REFUSED).toContain((await umami("DELETE", other, tokenA)).status);
    expect(REFUSED).toContain((await umami("GET", `/api/teams/${tenantB.teamId}`, tokenA)).status);

    const mine = await umami<{ data?: { id: string }[] }>("GET", "/api/websites?includeTeams=true", tokenA);
    expect(JSON.stringify(mine.body)).not.toContain(tenantB.websiteId);
  });

  it("cannot list users or other administrators' resources", async () => {
    expect(REFUSED).toContain((await umami("GET", "/api/admin/users", tokenA)).status);
    expect(REFUSED).toContain((await umami("GET", "/api/admin/websites", tokenA)).status);
  });
});

describe("token lifetime", () => {
  it("stops working when the user's password is rotated", async () => {
    const tenant = await provisionTenant(admin, `rotate-${runId()}`);
    const token = await signIn(tenant.username, tenant.password);
    expect((await umami("GET", `/api/websites/${tenant.websiteId}`, token)).status).toBe(200);

    const newPassword = await rotatePassword(admin, tenant);

    expect((await umami("GET", `/api/websites/${tenant.websiteId}`, token)).status).toBe(401);
    // The console signs in again with the new password and gets a working token.
    const fresh = await signIn(tenant.username, newPassword);
    expect((await umami("GET", `/api/websites/${tenant.websiteId}`, fresh)).status).toBe(200);
  });
});

describe("gap that Umami alone does not close", () => {
  /**
   * Umami lets any signed-in user create an API key, and a key is not tied to the password: it
   * keeps working after a rotation. Left reachable, it would let a tenant keep read access after
   * the console signed it out. The reverse proxy must therefore not publish `/api/me/api-keys`:
   * that is the path allow-list of specification 0001 §5.5.
   *
   * This test passes while the gap exists. If a later Umami closes it, the test fails and this
   * note is removed.
   */
  it("a view-only user can create an API key that survives a password rotation", async () => {
    const tenant = await provisionTenant(admin, `apikey-${runId()}`);
    const token = await signIn(tenant.username, tenant.password);

    const created = await umami<{ key?: string }>("POST", "/api/me/api-keys", token, { name: "kept" });
    expect(created.status).toBe(200);
    const key = created.body.key!;
    expect(key).toMatch(/^umami_/);

    await rotatePassword(admin, tenant);
    expect((await umami("GET", `/api/websites/${tenant.websiteId}`, token)).status).toBe(401);
    expect((await umami("GET", `/api/websites/${tenant.websiteId}`, key)).status).toBe(200);
    // Still read-only, and still its own team only.
    expect(REFUSED).toContain((await umami("DELETE", `/api/websites/${tenant.websiteId}`, key)).status);
    expect(REFUSED).toContain((await umami("GET", `/api/websites/${tenantB.websiteId}`, key)).status);
  });
});
