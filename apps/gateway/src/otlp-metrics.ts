/**
 * Turns an OTLP metrics export (JSON encoding) into hourly aggregate rows.
 *
 * The input is the Collector's reduced output: HTTP request-duration histograms only, delta
 * temporality, with the tenant and the service stamped on every data point by the Collector
 * from request metadata. Nothing here reads a tenant from anywhere else.
 */
import { normalizePath } from "@calistar/normalizer";

import { addBuckets, mapBuckets } from "./histogram.ts";

/** Attribute values the Collector sets when the gateway's headers were missing. */
export const UNBOUND = "unbound";

const AGGREGATION_TEMPORALITY_DELTA = 1;

/** The four metric names accepted: current and legacy semantic conventions. */
const METRICS: Record<string, { direction: "server" | "client"; legacy: boolean }> = {
  "http.server.request.duration": { direction: "server", legacy: false },
  "http.client.request.duration": { direction: "client", legacy: false },
  "http.server.duration": { direction: "server", legacy: true },
  "http.client.duration": { direction: "client", legacy: true },
};

const KNOWN_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "DELETE", "CONNECT", "OPTIONS", "TRACE", "PATCH", "QUERY"]);

/** Used when a data point carries no route and no path. */
export const UNKNOWN_ROUTE = "/:unknown";

// ─── OTLP JSON, the part that is read ─────────────────────────────────────────────────────────

interface AnyValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
}
interface KeyValue {
  key: string;
  value?: AnyValue;
}
interface HistogramDataPoint {
  attributes?: KeyValue[];
  timeUnixNano?: string | number;
  count?: string | number;
  sum?: number;
  bucketCounts?: (string | number)[];
  explicitBounds?: number[];
}
interface Metric {
  name?: string;
  unit?: string;
  histogram?: { dataPoints?: HistogramDataPoint[]; aggregationTemporality?: number | string };
}
export interface ExportMetricsRequest {
  resourceMetrics?: { scopeMetrics?: { metrics?: Metric[] }[] }[];
}

// ─── Output ───────────────────────────────────────────────────────────────────────────────────

export interface MetricRow {
  tenantId: string;
  serviceId: string;
  direction: "server" | "client";
  method: string;
  route: string;
  statusCode: number;
  /** Start of the hour, UTC, as an ISO string. */
  hour: string;
  requestCount: number;
  durationSumMs: number;
  bucketCounts: number[];
}

export interface Aggregation {
  rows: MetricRow[];
  /** Data points left out, by reason. Counted, never stored. */
  skipped: Record<string, number>;
}

function attributeMap(attributes: KeyValue[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const { key, value } of attributes ?? []) {
    if (!value) continue;
    if (value.stringValue !== undefined) map.set(key, value.stringValue);
    else if (value.intValue !== undefined) map.set(key, String(value.intValue));
    else if (value.doubleValue !== undefined) map.set(key, String(value.doubleValue));
  }
  return map;
}

function method(attrs: Map<string, string>): string {
  const raw = (attrs.get("http.request.method") ?? attrs.get("http.method") ?? "").toUpperCase();
  // Semantic conventions: anything else is reported as _OTHER, so a caller cannot grow the set.
  return KNOWN_METHODS.has(raw) ? raw : "_OTHER";
}

function route(attrs: Map<string, string>): string {
  const raw = attrs.get("http.route") ?? attrs.get("url.path") ?? attrs.get("http.target") ?? attrs.get("url.full") ?? attrs.get("http.url");
  if (raw === undefined || raw === "") return UNKNOWN_ROUTE;
  // A route set by the tenant goes through the rules too: a raw address is never kept.
  return normalizePath(raw);
}

function statusCode(attrs: Map<string, string>): number {
  const code = Number.parseInt(attrs.get("http.response.status_code") ?? attrs.get("http.status_code") ?? "", 10);
  return Number.isInteger(code) && code >= 100 && code <= 599 ? code : 0;
}

function hourOf(timeUnixNano: string | number | undefined): string | undefined {
  if (timeUnixNano === undefined) return undefined;
  let millis: number;
  try {
    millis = Number(BigInt(timeUnixNano) / 1_000_000n);
  } catch {
    return undefined;
  }
  if (!Number.isFinite(millis) || millis <= 0) return undefined;
  const date = new Date(millis);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

/** Duration unit of a metric, as a factor to milliseconds. Legacy metrics are in milliseconds. */
function toMsFactor(metric: Metric, legacy: boolean): number {
  if (metric.unit === "s") return 1000;
  if (metric.unit === "ms") return 1;
  return legacy ? 1 : 1000;
}

/**
 * Reduces one export to rows keyed by tenant, service, direction, method, route, status code and
 * hour. Data points with the same key are merged, so the result can be written in one statement.
 */
export function aggregate(request: ExportMetricsRequest): Aggregation {
  const rows = new Map<string, MetricRow>();
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };

  for (const resource of request.resourceMetrics ?? []) {
    for (const scope of resource.scopeMetrics ?? []) {
      for (const metric of scope.metrics ?? []) {
        const known = metric.name === undefined ? undefined : METRICS[metric.name];
        if (!known || !metric.histogram) {
          skip("not an HTTP duration histogram");
          continue;
        }
        const temporality = metric.histogram.aggregationTemporality;
        if (temporality !== AGGREGATION_TEMPORALITY_DELTA && temporality !== "AGGREGATION_TEMPORALITY_DELTA") {
          // A cumulative point would be added to the hourly row again at every export.
          skip("not delta temporality");
          continue;
        }
        const factor = toMsFactor(metric, known.legacy);

        for (const point of metric.histogram.dataPoints ?? []) {
          const attrs = attributeMap(point.attributes);
          const tenantId = attrs.get("tenant.id");
          const serviceId = attrs.get("calistar.service");
          if (!tenantId || !serviceId || tenantId === UNBOUND || serviceId === UNBOUND) {
            skip("no tenant bound by the gateway");
            continue;
          }
          const hour = hourOf(point.timeUnixNano);
          const count = Number(point.count ?? 0);
          if (hour === undefined || !Number.isFinite(count) || count <= 0) {
            skip("empty or undated data point");
            continue;
          }

          let buckets: number[];
          try {
            buckets = mapBuckets(
              (point.explicitBounds ?? []).map((bound) => bound * factor),
              (point.bucketCounts ?? []).map(Number),
            );
          } catch {
            skip("malformed histogram");
            continue;
          }

          const row: MetricRow = {
            tenantId,
            serviceId,
            direction: known.direction,
            method: method(attrs),
            route: route(attrs),
            statusCode: statusCode(attrs),
            hour,
            requestCount: count,
            durationSumMs: (point.sum ?? 0) * factor,
            bucketCounts: buckets,
          };
          const key = [row.tenantId, row.serviceId, row.direction, row.method, row.route, row.statusCode, row.hour].join("\u0000");
          const existing = rows.get(key);
          if (existing) {
            existing.requestCount += row.requestCount;
            existing.durationSumMs += row.durationSumMs;
            addBuckets(existing.bucketCounts, row.bucketCounts);
          } else {
            rows.set(key, row);
          }
        }
      }
    }
  }
  return { rows: [...rows.values()], skipped };
}
