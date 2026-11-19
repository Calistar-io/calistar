import { describe, expect, it } from "vitest";

import { otlpFront, replicaOrder, SERVICE_HEADER, TENANT_HEADER } from "../src/otlp-front.ts";
import { sha256Hex, TokenRegistry } from "../src/tenants.ts";

const TOKEN_A = "test-token-a";
const tokens = new TokenRegistry([
  [sha256Hex(TOKEN_A), { tenantId: "tenant-a", serviceId: "api" }],
  [sha256Hex("test-token-b"), { tenantId: "tenant-b", serviceId: "api" }],
]);

interface Call {
  url: string;
  headers: Headers;
  body: Uint8Array;
}

/** A stand-in for the Collector: records what it receives. `down` lists replicas that refuse the connection. */
function collector(down: string[] = []) {
  const calls: Call[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = String(input);
    if (down.some((host) => url.startsWith(host))) throw new TypeError("fetch failed");
    calls.push({ url, headers: new Headers(init?.headers), body: new Uint8Array(init?.body as ArrayBuffer) });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  return { calls, fake };
}

const post = (app: ReturnType<typeof otlpFront>, path: string, headers: Record<string, string>, body: string | Uint8Array = "{}") =>
  app.request(path, { method: "POST", headers, body });

describe("OTLP front", () => {
  it("refuses a request without a valid ingest token", async () => {
    const { calls, fake } = collector();
    const app = otlpFront({ tokens, collectorUrls: ["http://c1:4318"], maxBodyBytes: 1024, fetch: fake });

    expect((await post(app, "/v1/metrics", {})).status).toBe(401);
    expect((await post(app, "/v1/metrics", { authorization: "Bearer nope" })).status).toBe(401);
    expect((await post(app, "/v1/traces", { authorization: TOKEN_A })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("binds the tenant and the service from the token, whatever the caller sends", async () => {
    const { calls, fake } = collector();
    const app = otlpFront({ tokens, collectorUrls: ["http://c1:4318"], maxBodyBytes: 1024, fetch: fake });

    const res = await post(app, "/v1/metrics", {
      authorization: `Bearer ${TOKEN_A}`,
      "content-type": "application/x-protobuf",
      [TENANT_HEADER]: "tenant-b",
      [SERVICE_HEADER]: "someone-else",
      "x-forwarded-for": "203.0.113.77",
      cookie: "session=1",
    });

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const { url, headers } = calls[0]!;
    expect(url).toBe("http://c1:4318/v1/metrics");
    expect(headers.get(TENANT_HEADER)).toBe("tenant-a");
    expect(headers.get(SERVICE_HEADER)).toBe("api");
    expect(headers.get("content-type")).toBe("application/x-protobuf");
    // Nothing else travels: not the token, not the caller's address, not its cookies.
    expect([...headers.keys()].sort()).toEqual(["content-type", SERVICE_HEADER, TENANT_HEADER].sort());
  });

  it("forwards the body unchanged, for each signal", async () => {
    const { calls, fake } = collector();
    const app = otlpFront({ tokens, collectorUrls: ["http://c1:4318"], maxBodyBytes: 1024, fetch: fake });
    const body = new Uint8Array([0, 1, 2, 250, 251, 255]);

    for (const signal of ["metrics", "traces", "logs"]) {
      await post(app, `/v1/${signal}`, { authorization: `Bearer ${TOKEN_A}` }, body);
    }
    expect(calls.map((c) => c.url)).toEqual(["http://c1:4318/v1/metrics", "http://c1:4318/v1/traces", "http://c1:4318/v1/logs"]);
    for (const call of calls) expect([...call.body]).toEqual([...body]);
  });

  it("refuses a body over the limit", async () => {
    const { calls, fake } = collector();
    const app = otlpFront({ tokens, collectorUrls: ["http://c1:4318"], maxBodyBytes: 16, fetch: fake });
    const res = await post(app, "/v1/metrics", { authorization: `Bearer ${TOKEN_A}` }, "x".repeat(64));
    expect(res.status).toBe(413);
    expect(calls).toEqual([]);
  });

  it("always sends a binding to the same replica, and moves on only when it is down", async () => {
    const replicas = ["http://c1:4318", "http://c2:4318"];
    const binding = { tenantId: "tenant-a", serviceId: "api" };
    const [first, second] = replicaOrder(binding, replicas);
    expect(replicaOrder(binding, [...replicas].reverse())).toEqual([first, second]);

    const up = collector();
    const app = otlpFront({ tokens, collectorUrls: replicas, maxBodyBytes: 1024, fetch: up.fake });
    for (let i = 0; i < 5; i++) await post(app, "/v1/metrics", { authorization: `Bearer ${TOKEN_A}` });
    expect(new Set(up.calls.map((c) => c.url))).toEqual(new Set([`${first}/v1/metrics`]));

    const failing = collector([first!]);
    const app2 = otlpFront({ tokens, collectorUrls: replicas, maxBodyBytes: 1024, fetch: failing.fake });
    expect((await post(app2, "/v1/metrics", { authorization: `Bearer ${TOKEN_A}` })).status).toBe(200);
    expect(failing.calls.map((c) => c.url)).toEqual([`${second}/v1/metrics`]);

    const allDown = collector(replicas);
    const app3 = otlpFront({ tokens, collectorUrls: replicas, maxBodyBytes: 1024, fetch: allDown.fake });
    expect((await post(app3, "/v1/metrics", { authorization: `Bearer ${TOKEN_A}` })).status).toBe(503);
  });
});
