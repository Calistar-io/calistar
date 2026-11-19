/**
 * API analytics, end to end: gateway -> Collector -> gateway -> PostgreSQL.
 *
 * Claims checked on the running stack:
 * - traces and logs sent to the endpoint leave nothing in storage or in the logs;
 * - a raw path and an attribute outside the allow-list are not kept either;
 * - a data point is stored under the token's tenant, whatever the payload says;
 * - a cumulative stream is converted without double counting, and two tenants do not share state.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { exponentialHistogramExport, histogramExport, logExport, send, traceExport } from "../support/otlp.ts";
import { CALISTAR_DB, UMAMI_DB, eventually, everythingKept, query, runId, tableCounts, TOKEN_A, TOKEN_B } from "../support/stack.ts";

interface Row {
  tenant_id: string;
  service_id: string;
  route: string;
  status_code: number;
  request_count: string;
}

const rowsFor = (routePrefix: string) =>
  query<Row>(CALISTAR_DB, "SELECT tenant_id, service_id, route, status_code, request_count FROM api_metric_1h WHERE route LIKE $1 ORDER BY tenant_id, route", [
    `/${routePrefix}/%`,
  ]);

const total = (rows: Row[]) => rows.reduce((sum, row) => sum + Number(row.request_count), 0);

const http = (route: string, extra: Record<string, string | number> = {}) => ({
  "http.request.method": "GET",
  "http.route": route,
  "http.response.status_code": 200,
  ...extra,
});

/** Lets a batch that would be written reach the database before a "nothing was stored" check. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 4000));

describe("traces, logs and raw values leave nothing behind", () => {
  it("stores one aggregate row and nothing else", async () => {
    const marker = randomUUID();
    const run = runId();
    const calistarBefore = await tableCounts(CALISTAR_DB);
    const umamiBefore = await tableCounts(UMAMI_DB);

    // The marker sits in a span name, a span attribute, a log body, a log attribute, a request
    // path and a metric attribute that is not part of the schema.
    const responses = await Promise.all([
      send("traces", traceExport(`GET /orders/${marker}`, { "user.email": `${marker}@example.org` }), TOKEN_A),
      send("logs", logExport(`order ${marker} paid by ${marker}@example.org`, { "order.id": marker }), TOKEN_A),
      send(
        "metrics",
        histogramExport([{ attrs: http(`/${run}/orders/${marker}`, { "user.email": `${marker}@example.org`, "order.id": marker }), count: 3 }], {
          resourceAttrs: { "service.name": "orders", "deployment.id": marker },
        }),
        TOKEN_A,
      ),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);

    const rows = await eventually(async () => {
      const found = await rowsFor(run);
      return found.length > 0 ? found : undefined;
    }, "the aggregate row");
    expect(rows).toEqual([{ tenant_id: "tenant-a", service_id: "example-api", route: `/${run}/orders/:uuid`, status_code: 200, request_count: "3" }]);

    // Row counts: one more row in api_metric_1h, every other table of both databases unchanged.
    const calistarAfter = await tableCounts(CALISTAR_DB);
    expect(calistarAfter).toEqual({ ...calistarBefore, api_metric_1h: calistarBefore.api_metric_1h! + 1 });
    expect(await tableCounts(UMAMI_DB)).toEqual(umamiBefore);

    // The marker is nowhere: not in a dump of either database, not in the services' logs.
    const kept = everythingKept();
    expect(kept).toContain(`/${run}/orders/:uuid`);
    expect(kept).not.toContain(marker);
  });

  it("stores nothing at all for an export of traces and logs only", async () => {
    const before = await tableCounts(CALISTAR_DB);
    const marker = randomUUID();
    await send("traces", traceExport(`span ${marker}`), TOKEN_A);
    await send("logs", logExport(`log ${marker}`), TOKEN_A);
    await settle();
    expect(await tableCounts(CALISTAR_DB)).toEqual(before);
    expect(everythingKept()).not.toContain(marker);
  });

  it("drops a metric that is not an HTTP request duration", async () => {
    const run = runId();
    const before = await tableCounts(CALISTAR_DB);
    const res = await send("metrics", histogramExport([{ attrs: http(`/${run}/x`), count: 5 }], { name: "db.client.operation.duration" }), TOKEN_A);
    expect(res.status).toBe(200);
    await settle();
    expect(await tableCounts(CALISTAR_DB)).toEqual(before);
  });
});

describe("a data point belongs to the token's tenant", () => {
  it("refuses a request without a valid ingest token", async () => {
    const body = histogramExport([{ attrs: http("/x"), count: 1 }]);
    expect((await send("metrics", body)).status).toBe(401);
    expect((await send("metrics", body, "not-a-token")).status).toBe(401);
    expect((await send("traces", traceExport("x"))).status).toBe(401);
    expect((await send("logs", logExport("x"))).status).toBe(401);
  });

  it("ignores a tenant named in the payload, in the resource or in a request header", async () => {
    const run = runId();
    const res = await send(
      "metrics",
      histogramExport([{ attrs: http(`/${run}/claim`, { "tenant.id": "tenant-b", "calistar.service": "someone-else" }), count: 4 }], {
        resourceAttrs: { "tenant.id": "tenant-b" },
      }),
      TOKEN_A,
      { "x-calistar-tenant": "tenant-b", "x-calistar-service": "someone-else" },
    );
    expect(res.status).toBe(200);

    const rows = await eventually(async () => {
      const found = await rowsFor(run);
      return found.length > 0 ? found : undefined;
    }, "the row of the spoofing attempt");
    expect(rows).toEqual([{ tenant_id: "tenant-a", service_id: "example-api", route: `/${run}/claim`, status_code: 200, request_count: "4" }]);
  });

  it("stores nothing for a data point that names the tenant twice", async () => {
    const run = runId();
    for (const order of [["tenant-b", "tenant-b"], ["tenant-a", "tenant-b"]]) {
      await send(
        "metrics",
        histogramExport([
          {
            attrs: [
              ["tenant.id", order[0]!],
              ["http.request.method", "GET"],
              ["http.route", `/${run}/dup`],
              ["http.response.status_code", 200],
              ["tenant.id", order[1]!],
            ],
            count: 7,
          },
        ]),
        TOKEN_A,
      );
    }
    await settle();
    expect(await rowsFor(run)).toEqual([]);
  });

  it("keeps two tenants' data apart", async () => {
    const run = runId();
    await send("metrics", histogramExport([{ attrs: http(`/${run}/shared`), count: 2 }]), TOKEN_A);
    await send("metrics", histogramExport([{ attrs: http(`/${run}/shared`), count: 9 }]), TOKEN_B);
    const rows = await eventually(async () => {
      const found = await rowsFor(run);
      return found.length === 2 ? found : undefined;
    }, "one row per tenant");
    expect(rows.map((r) => [r.tenant_id, r.request_count])).toEqual([
      ["tenant-a", "2"],
      ["tenant-b", "9"],
    ]);
  });
});

describe("temporality", () => {
  it("adds delta exports of the same hour into one row", async () => {
    const run = runId();
    for (const count of [3, 4, 5]) await send("metrics", histogramExport([{ attrs: http(`/${run}/delta`), count }]), TOKEN_A);
    const rows = await eventually(async () => {
      const found = await rowsFor(run);
      return total(found) === 12 ? found : undefined;
    }, "the three exports summed");
    expect(rows).toHaveLength(1);
  });

  it("converts a cumulative stream without counting it twice, and without sharing state between tenants", async () => {
    const run = runId();
    const start = Date.now() - 120_000;
    // The same stream, attribute for attribute, sent by two tenants with different values.
    const cumulative = (count: number, step: number) =>
      histogramExport([{ attrs: http(`/${run}/cumulative`), count, startTimeMs: start, timeMs: Date.now() - 60_000 + step * 1000 }], { temporality: 2 });

    const series: [string, number[]][] = [
      [TOKEN_A, [100, 110, 125]],
      [TOKEN_B, [5, 9, 20]],
    ];
    for (let step = 0; step < 3; step++) {
      for (const [token, values] of series) {
        expect((await send("metrics", cumulative(values[step]!, step), token)).status).toBe(200);
      }
    }

    // The first point of each stream is a baseline. What is stored is the growth after it:
    // 125 - 100 = 25 for tenant A, 20 - 5 = 15 for tenant B. Sums of raw values would be 335 and 34.
    const rows = await eventually(async () => {
      const found = await rowsFor(run);
      return total(found) === 40 ? found : undefined;
    }, "the converted cumulative streams");
    expect(rows.map((r) => [r.tenant_id, r.request_count])).toEqual([
      ["tenant-a", "25"],
      ["tenant-b", "15"],
    ]);
  });

  it("records what happens to an exponential histogram: it is dropped", async () => {
    const run = runId();
    const res = await send("metrics", exponentialHistogramExport(http(`/${run}/exponential`), 6), TOKEN_A);
    expect(res.status).toBe(200);
    await settle();
    expect(await rowsFor(run)).toEqual([]);
  });
});
