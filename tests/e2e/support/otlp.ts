/** Builds and sends OTLP exports (JSON encoding) to the gateway, as a tenant's service would. */
import { GATEWAY_URL } from "./stack.ts";

export const DEFAULT_BOUNDS_S = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

type AttrValue = string | number;
export type Attrs = Record<string, AttrValue> | [string, AttrValue][];

export function attributes(attrs: Attrs) {
  const entries = Array.isArray(attrs) ? attrs : Object.entries(attrs);
  return entries.map(([key, value]) => ({
    key,
    value: typeof value === "number" ? { intValue: String(value) } : { stringValue: value },
  }));
}

const nanos = (ms: number): string => String(BigInt(Math.round(ms)) * 1_000_000n);

export interface HistogramPoint {
  attrs: Attrs;
  count: number;
  /** Total duration, in seconds. */
  sum?: number;
  timeMs?: number;
  startTimeMs?: number;
}

export interface HistogramOptions {
  name?: string;
  /** 1: delta, 2: cumulative. */
  temporality?: 1 | 2;
  resourceAttrs?: Attrs;
}

/** An export holding one explicit-bucket histogram metric. */
export function histogramExport(points: HistogramPoint[], { name = "http.server.request.duration", temporality = 1, resourceAttrs = {} }: HistogramOptions = {}) {
  const now = Date.now();
  return {
    resourceMetrics: [
      {
        resource: { attributes: attributes(resourceAttrs) },
        scopeMetrics: [
          {
            scope: { name: "calistar-stack-test" },
            metrics: [
              {
                name,
                unit: "s",
                histogram: {
                  aggregationTemporality: temporality,
                  dataPoints: points.map((p) => ({
                    attributes: attributes(p.attrs),
                    startTimeUnixNano: nanos(p.startTimeMs ?? now - 60_000),
                    timeUnixNano: nanos(p.timeMs ?? now),
                    count: String(p.count),
                    sum: p.sum ?? p.count * 0.004,
                    // Everything in the first bucket (up to 5 ms).
                    bucketCounts: [String(p.count), ...DEFAULT_BOUNDS_S.map(() => "0")],
                    explicitBounds: DEFAULT_BOUNDS_S,
                  })),
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** An export holding one exponential histogram metric. */
export function exponentialHistogramExport(attrs: Attrs, count: number) {
  const now = Date.now();
  return {
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: "http.server.request.duration",
                unit: "s",
                exponentialHistogram: {
                  aggregationTemporality: 1,
                  dataPoints: [
                    {
                      attributes: attributes(attrs),
                      startTimeUnixNano: nanos(now - 60_000),
                      timeUnixNano: nanos(now),
                      count: String(count),
                      sum: count * 0.004,
                      scale: 0,
                      zeroCount: "0",
                      positive: { offset: -8, bucketCounts: [String(count)] },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  };
}

export function traceExport(spanName: string, attrs: Attrs = {}) {
  const now = Date.now();
  return {
    resourceSpans: [
      {
        scopeSpans: [
          {
            spans: [
              {
                traceId: "5b8efff798038103d269b633813fc60c",
                spanId: "eee19b7ec3c1b174",
                name: spanName,
                kind: 2,
                startTimeUnixNano: nanos(now - 50),
                endTimeUnixNano: nanos(now),
                attributes: attributes(attrs),
              },
            ],
          },
        ],
      },
    ],
  };
}

export function logExport(body: string, attrs: Attrs = {}) {
  return {
    resourceLogs: [
      {
        scopeLogs: [
          {
            logRecords: [{ timeUnixNano: nanos(Date.now()), severityText: "INFO", body: { stringValue: body }, attributes: attributes(attrs) }],
          },
        ],
      },
    ],
  };
}

/** Posts an export to the gateway's public OTLP endpoint. */
export function send(signal: "metrics" | "traces" | "logs", body: unknown, token?: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${GATEWAY_URL}/v1/${signal}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify(body),
  });
}
