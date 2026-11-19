/**
 * What the console will do against Umami, over the private network: provision a tenant (team,
 * website, view-only user) and sign that user in. In the proof of concept it is test support
 * code; it moves into the console with enrollment.
 *
 * Routes and bodies were read from Umami v3.5.0 and are exercised by tests/sso.test.ts.
 */
import { randomBytes } from "node:crypto";

import { UMAMI_URL } from "./stack.ts";

/** Umami's first-boot administrator. The console replaces this password at installation. */
const ADMIN = { username: "admin", password: "umami" };

export interface UmamiResponse<T> {
  status: number;
  body: T;
}

/** Calls Umami's API. Never throws on an HTTP error: tests assert on the status. */
export async function umami<T = unknown>(method: string, path: string, token?: string, body?: unknown): Promise<UmamiResponse<T>> {
  const res = await fetch(`${UMAMI_URL}${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: keep the text.
  }
  return { status: res.status, body: parsed as T };
}

/** Signs in with a username and a password. Returns Umami's bearer token. */
export async function signIn(username: string, password: string): Promise<string> {
  const res = await umami<{ token?: string }>("POST", "/api/auth/login", undefined, { username, password });
  if (res.status !== 200 || !res.body.token) throw new Error(`Umami sign-in failed for ${username}: ${res.status}`);
  return res.body.token;
}

export const adminToken = (): Promise<string> => signIn(ADMIN.username, ADMIN.password);

export const randomPassword = (): string => randomBytes(24).toString("base64url");

export interface Tenant {
  teamId: string;
  websiteId: string;
  userId: string;
  username: string;
  password: string;
}

async function expectOk<T>(what: string, res: UmamiResponse<T>): Promise<T> {
  if (res.status !== 200) throw new Error(`${what}: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);
  return res.body;
}

/**
 * Provisions one tenant: a team, a website in that team, and a user who can only read.
 * The user has the global role `view-only` and the team role `team-view-only`.
 */
export async function provisionTenant(admin: string, name: string, domain = "example.org"): Promise<Tenant> {
  const [team] = await expectOk("create team", await umami<[{ id: string }, unknown]>("POST", "/api/teams", admin, { name }));
  const website = await expectOk("create website", await umami<{ id: string }>("POST", "/api/websites", admin, { name, domain, teamId: team.id }));
  const username = `${name}-viewer`.toLowerCase();
  const password = randomPassword();
  const user = await expectOk("create user", await umami<{ id: string }>("POST", "/api/users", admin, { username, password, role: "view-only" }));
  await expectOk("add user to team", await umami("POST", `/api/teams/${team.id}/users`, admin, { userId: user.id, role: "team-view-only" }));
  return { teamId: team.id, websiteId: website.id, userId: user.id, username, password };
}

/** Creates a website that belongs to no team, for tests that only need somewhere to send events. */
export async function createWebsite(admin: string, name: string, domain = "example.org"): Promise<string> {
  const website = await expectOk("create website", await umami<{ id: string }>("POST", "/api/websites", admin, { name, domain }));
  return website.id;
}

/** The administrator sets a new password for a user: every token issued before stops working. */
export async function rotatePassword(admin: string, tenant: Tenant): Promise<string> {
  const password = randomPassword();
  await expectOk("rotate password", await umami("POST", `/api/users/${tenant.userId}`, admin, { username: tenant.username, password, role: "view-only" }));
  return password;
}

export interface Stats {
  pageviews: number;
  visitors: number;
  visits: number;
  bounces: number;
  totaltime: number;
}

/** A website's totals over the last hour. */
export function stats(token: string, websiteId: string): Promise<UmamiResponse<Stats>> {
  const now = Date.now();
  return umami<Stats>("GET", `/api/websites/${websiteId}/stats?startAt=${now - 3_600_000}&endAt=${now + 60_000}`, token);
}
