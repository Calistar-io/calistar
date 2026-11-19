import { describe, expect, it } from "vitest";

import { BUCKET_BOUNDS_MS, BUCKET_COUNT, mapBuckets } from "../src/histogram.ts";
import { aggregate as aggregateAt, MAX_AGE_MS, MAX_FUTURE_MS, OVERSIZED_ROUTE, UNKNOWN_ROUTE, type ExportMetricsRequest } from "../src/otlp-metrics.ts";

const ACCOUNT = "GAUJMRUP23T5XGUUWR7UDPJFZQFB5YFCEVUPLD5XABUEHQT2V3VIJFMJ";
const HOUR = "2026-11-19T10:00:00.000Z";
/** 10:20:00 UTC of the same hour, in nanoseconds. */
const TIME = String(BigInt(Date.parse("2026-11-19T10:20:00.000Z")) * 1_000_000n);

/** "Now" for the tests: ten minutes after the data points. */
const NOW = Date.parse("2026-11-19T10:30:00.000Z");
const aggregate = (req: ExportMetricsRequest) => aggregateAt(req, NOW);

const DEFAULT_BOUNDS_S = BUCKET_BOUNDS_MS.map((ms) => ms / 1000);

type Attrs = Record<string, string | number>;
const attributes = (attrs: Attrs) =>
  Object.entries(attrs).map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { intValue: String(value) } : { stringValue: value },
  }));

interface PointInput {
  attrs: Attrs;
  count: number | string;
  sum: number;
  buckets?: (number | string)[];
  bounds?: number[];
  time?: string;
  /** Extra attribute entries appended as is, to build lists with repeated keys. */
  rawAttributes?: { key: string; value: { stringValue: string } }[];
}
function request(name: string, points: PointInput[], extra: { temporality?: number; unit?: string } = {}): ExportMetricsRequest {
  return {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name,
                unit: extra.unit,
                histogram: {
                  aggregationTemporality: extra.temporality ?? 1,
                  dataPoints: points.map((p) => {
                    const bounds = p.bounds ?? DEFAULT_BOUNDS_S;
                    const buckets = p.buckets ?? [p.count, ...new Array<number>(bounds.length).fill(0)];
                    return {
                      attributes: [...attributes(p.attrs), ...(p.rawAttributes ?? [])],
                      timeUnixNano: p.time ?? TIME,
                      count: String(p.count),
                      sum: p.sum,
                      bucketCounts: buckets.map(String),
                      explicitBounds: bounds,
                    };
                  }),
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

const bound = { "tenant.id": "tenant-a", "calistar.service": "api" };

describe("bucket mapping", () => {
  it("keeps a histogram that already uses the fixed bounds", () => {
    const counts = Array.from({ length: BUCKET_COUNT }, (_, i) => i + 1);
    expect(mapBuckets(BUCKET_BOUNDS_MS, counts)).toEqual(counts);
  });

  it("maps other bounds by upper bound", () => {
    // Bounds 20, 200, 20000 ms: 20 -> bucket <=25, 200 -> bucket <=250, 20000 and the rest -> overflow.
    const out = mapBuckets([20, 200, 20000], [3, 5, 7, 11]);
    expect(out[BUCKET_BOUNDS_MS.indexOf(25)]).toBe(3);
    expect(out[BUCKET_BOUNDS_MS.indexOf(250)]).toBe(5);
    expect(out[BUCKET_COUNT - 1]).toBe(18);
    expect(out.reduce((a, b) => a + b, 0)).toBe(26);
  });

  it("refuses counts that do not match the bounds", () => {
    expect(() => mapBuckets([10, 20], [1, 2])).toThrow();
  });
});

describe("aggregate", () => {
  it("maps current semantic conventions, in seconds", () => {
    const { rows, skipped } = aggregate(
      request(
        "http.server.request.duration",
        [{ attrs: { ...bound, "http.request.method": "GET", "http.route": "/accounts/:id", "http.response.status_code": 200 }, count: 4, sum: 0.5 }],
        { unit: "s" },
      ),
    );
    expect(skipped).toEqual({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: "tenant-a",
      serviceId: "api",
      direction: "server",
      method: "GET",
      route: "/accounts/:id",
      statusCode: 200,
      hour: HOUR,
      requestCount: 4,
      durationSumMs: 500,
    });
    expect(rows[0]!.bucketCounts[0]).toBe(4);
  });

  it("maps legacy names, in milliseconds, to the same schema", () => {
    const { rows } = aggregate(
      request(
        "http.client.duration",
        [{ attrs: { ...bound, "http.method": "post", "http.target": "/pay?memo=1", "http.status_code": 503 }, count: 2, sum: 300, bounds: [5, 250], buckets: [0, 2, 0] }],
        { unit: "ms" },
      ),
    );
    expect(rows[0]).toMatchObject({ direction: "client", method: "POST", route: "/pay", statusCode: 503, durationSumMs: 300, requestCount: 2 });
    expect(rows[0]!.bucketCounts[BUCKET_BOUNDS_MS.indexOf(250)]).toBe(2);
  });

  it("normalizes the route, including one the tenant set itself", () => {
    const { rows } = aggregate(
      request("http.server.request.duration", [
        { attrs: { ...bound, "http.request.method": "GET", "url.path": `/accounts/${ACCOUNT}/payments`, "http.response.status_code": 200 }, count: 1, sum: 0.01 },
        { attrs: { ...bound, "http.request.method": "GET", "http.route": `/accounts/${ACCOUNT}`, "http.response.status_code": 200 }, count: 1, sum: 0.01 },
      ]),
    );
    expect(rows.map((r) => r.route).sort()).toEqual(["/accounts/:account", "/accounts/:account/payments"]);
    expect(JSON.stringify(rows)).not.toContain(ACCOUNT);
  });

  it("merges data points of the same key: counts, duration and buckets are summed", () => {
    const attrs = { ...bound, "http.request.method": "GET", "http.route": "/health", "http.response.status_code": 200 };
    const { rows } = aggregate(
      request("http.server.request.duration", [
        { attrs, count: 3, sum: 0.03, buckets: [1, 2, ...new Array<number>(BUCKET_COUNT - 2).fill(0)] },
        { attrs, count: 5, sum: 0.07, buckets: [5, 0, ...new Array<number>(BUCKET_COUNT - 2).fill(0)] },
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.requestCount).toBe(8);
    expect(rows[0]!.durationSumMs).toBeCloseTo(100);
    expect(rows[0]!.bucketCounts.slice(0, 2)).toEqual([6, 2]);
  });

  it("skips a data point the gateway did not bind to a tenant", () => {
    const { rows, skipped } = aggregate(
      request("http.server.request.duration", [
        { attrs: { "tenant.id": "unbound", "calistar.service": "unbound", "http.route": "/x" }, count: 1, sum: 0.01 },
        { attrs: { "http.route": "/x" }, count: 1, sum: 0.01 },
      ]),
    );
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ "no tenant bound by the gateway": 2 });
  });

  it("skips cumulative data, which would be counted again at every export", () => {
    const { rows, skipped } = aggregate(request("http.server.request.duration", [{ attrs: bound, count: 9, sum: 1 }], { temporality: 2 }));
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ "not delta temporality": 1 });
  });

  it("skips any other metric", () => {
    const { rows, skipped } = aggregate(request("db.client.operation.duration", [{ attrs: bound, count: 1, sum: 1 }]));
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ "not an HTTP duration histogram": 1 });
  });

  it("folds unknown methods, missing routes and missing status codes into fixed values", () => {
    const { rows } = aggregate(request("http.server.request.duration", [{ attrs: { ...bound, "http.request.method": "PROPFIND-x" }, count: 1, sum: 0.01 }]));
    expect(rows[0]).toMatchObject({ method: "_OTHER", route: UNKNOWN_ROUTE, statusCode: 0 });
  });

  it("does not fail on an empty or malformed export", () => {
    expect(aggregate({}).rows).toEqual([]);
    const { rows, skipped } = aggregate(
      request("http.server.request.duration", [{ attrs: bound, count: 1, sum: 0.01, bounds: [0.1], buckets: [1, 0, 0] }]),
    );
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ "malformed histogram": 1 });
  });
});

describe("aggregate, hostile or broken input", () => {
  const ok = { ...bound, "http.request.method": "GET", "http.route": "/x", "http.response.status_code": 200 };

  it("refuses a data point that repeats an attribute key, whichever value comes first", () => {
    for (const [first, second] of [["tenant-a", "tenant-b"], ["tenant-b", "tenant-a"]]) {
      const { rows, skipped } = aggregate(
        request("http.server.request.duration", [
          {
            attrs: { "tenant.id": first!, "calistar.service": "api", "http.route": "/x" },
            rawAttributes: [{ key: "tenant.id", value: { stringValue: second! } }],
            count: 1,
            sum: 0.01,
          },
        ]),
      );
      expect(rows).toEqual([]);
      expect(skipped).toEqual({ "repeated attribute key": 1 });
    }
  });

  it.each([
    ["negative count", { count: -1, buckets: [-1] }],
    ["fractional count", { count: 1.5, buckets: [1.5] }],
    ["count beyond a safe integer", { count: "99999999999999999999", buckets: ["99999999999999999999"] }],
    ["count that is not a number", { count: "1e3", buckets: ["1e3"] }],
    ["buckets that do not add up to the count", { count: 5, buckets: [1] }],
    ["count over the per-point ceiling", { count: 2e12, buckets: [2e12] }],
    ["duration over the per-point ceiling", { count: 1, sum: 1e13 }],
    ["negative sum", { count: 1, sum: -1 }],
    ["infinite sum", { count: 1, sum: Number.POSITIVE_INFINITY }],
  ])("skips a histogram with a %s", (_name, fields) => {
    const base = { attrs: ok, count: 1, sum: 0.01 };
    const point = { ...base, ...fields } as PointInput;
    if (point.buckets) point.buckets = [...point.buckets, ...new Array<number>(DEFAULT_BOUNDS_S.length).fill(0)];
    const { rows, skipped } = aggregate(request("http.server.request.duration", [point]));
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ "malformed histogram": 1 });
  });

  it("refuses a data point too old, in the future, or with an unreadable time", () => {
    const nanos = (ms: number) => String(BigInt(ms) * 1_000_000n);
    const times = [nanos(NOW - MAX_AGE_MS - 1000), nanos(NOW + MAX_FUTURE_MS + 1000), "0", "not-a-time", "-5", "9".repeat(30)];
    const { rows, skipped } = aggregate(request("http.server.request.duration", times.map((time) => ({ attrs: ok, count: 1, sum: 0.01, time }))));
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ "time missing or outside the accepted window": times.length });
  });

  it("accepts a data point at the edges of the window", () => {
    const nanos = (ms: number) => String(BigInt(ms) * 1_000_000n);
    const { rows } = aggregate(
      request("http.server.request.duration", [
        { attrs: ok, count: 1, sum: 0.01, time: nanos(NOW - MAX_AGE_MS + 1000) },
        { attrs: ok, count: 1, sum: 0.01, time: nanos(NOW + MAX_FUTURE_MS - 1000) },
      ]),
    );
    expect(rows).toHaveLength(2);
  });

  it("stores an oversized route as one placeholder", () => {
    const deep = "/" + new Array<string>(40).fill("a").join("/");
    const wide = "/" + new Array<string>(10).fill("b-".repeat(30)).join("/");
    const { rows } = aggregate(
      request("http.server.request.duration", [
        { attrs: { ...ok, "http.route": deep }, count: 1, sum: 0.01 },
        { attrs: { ...ok, "http.route": wide }, count: 1, sum: 0.01 },
      ]),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ route: OVERSIZED_ROUTE, requestCount: 2 });
  });

  it("skips an empty data point", () => {
    const { rows, skipped } = aggregate(request("http.server.request.duration", [{ attrs: ok, count: 0, sum: 0 }]));
    expect(rows).toEqual([]);
    expect(skipped).toEqual({ "empty data point": 1 });
  });
});
