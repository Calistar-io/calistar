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

/** A normalized route longer than this, or with more segments, is stored as one placeholder. */
export const MAX_ROUTE_LENGTH = 256;
export const MAX_ROUTE_SEGMENTS = 16;
export const OVERSIZED_ROUTE = "/:long";

/**
 * Accepted age of a data point. Older or future points are refused, so a tenant cannot rewrite
 * hours that are already reported, and a wrong clock cannot write far in the future.
 */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const MAX_FUTURE_MS = 10 * 60 * 1000;

/**
 * Ceilings on one data point: far above any real export interval, far below what a 64-bit
 * column or a JavaScript number can hold. A stored row saturates at ROW_CEILING (see db.ts), so
 * no sequence of accepted points can make the database refuse a batch.
 */
export const MAX_POINT_COUNT = 1e12;
export const MAX_POINT_DURATION_MS = 1e15;
export const ROW_CEILING = 9e15;

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

/**
 * Attributes of a data point, or `undefined` when a key appears twice. OTLP lets a list repeat a
 * key, and two readers may then disagree on which value counts: the Collector could stamp one
 * `tenant.id` while this code reads the other. A point with a repeated key is refused whole.
 */
function attributeMap(attributes: KeyValue[] | undefined): Map<string, string> | undefined {
  const map = new Map<string, string>();
  const seen = new Set<string>();
  for (const { key, value } of attributes ?? []) {
    if (typeof key !== "string" || seen.has(key)) return undefined;
    seen.add(key);
    if (!value) continue;
    if (value.stringValue !== undefined) map.set(key, String(value.stringValue));
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
  const normalized = normalizePath(raw);
  if (normalized.length > MAX_ROUTE_LENGTH || normalized.split("/").length - 1 > MAX_ROUTE_SEGMENTS) return OVERSIZED_ROUTE;
  return normalized;
}

function statusCode(attrs: Map<string, string>): number {
  const code = Number.parseInt(attrs.get("http.response.status_code") ?? attrs.get("http.status_code") ?? "", 10);
  return Number.isInteger(code) && code >= 100 && code <= 599 ? code : 0;
}

/** Start of the hour of a data point, or `undefined` when its time is unreadable or outside the accepted window. */
function hourOf(timeUnixNano: string | number | undefined, now: number): string | undefined {
  if (timeUnixNano === undefined) return undefined;
  let millis: number;
  try {
    millis = Number(BigInt(timeUnixNano) / 1_000_000n);
  } catch {
    return undefined;
  }
  if (!Number.isFinite(millis) || millis < now - MAX_AGE_MS || millis > now + MAX_FUTURE_MS) return undefined;
  const date = new Date(millis);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

/** A count as OTLP JSON carries it (a number, or a decimal string for 64-bit values). */
function count(value: string | number | undefined): number | undefined {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : undefined;
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
export function aggregate(request: ExportMetricsRequest, now: number = Date.now()): Aggregation {
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
          if (!attrs) {
            skip("repeated attribute key");
            continue;
          }
          const tenantId = attrs.get("tenant.id");
          const serviceId = attrs.get("calistar.service");
          if (!tenantId || !serviceId || tenantId === UNBOUND || serviceId === UNBOUND) {
            skip("no tenant bound by the gateway");
            continue;
          }
          const hour = hourOf(point.timeUnixNano, now);
          if (hour === undefined) {
            skip("time missing or outside the accepted window");
            continue;
          }

          // Every number is checked before it can reach the database: a value PostgreSQL would
          // refuse must not turn into an error the Collector retries forever.
          const requestCount = count(point.count);
          const bucketCounts = (point.bucketCounts ?? []).map(count);
          const bounds = point.explicitBounds ?? [];
          const sum = point.sum ?? 0;
          const wellFormed =
            requestCount !== undefined &&
            bucketCounts.every((n) => n !== undefined) &&
            bucketCounts.reduce<number>((total, n) => total + (n ?? 0), 0) === requestCount &&
            bounds.every((bound) => typeof bound === "number" && Number.isFinite(bound)) &&
            requestCount <= MAX_POINT_COUNT &&
            typeof sum === "number" &&
            Number.isFinite(sum) &&
            sum >= 0 &&
            sum * factor <= MAX_POINT_DURATION_MS;
          if (!wellFormed) {
            skip("malformed histogram");
            continue;
          }
          if (requestCount === 0) {
            skip("empty data point");
            continue;
          }

          let buckets: number[];
          try {
            buckets = mapBuckets(
              bounds.map((bound) => bound * factor),
              bucketCounts as number[],
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
            requestCount,
            durationSumMs: sum * factor,
            bucketCounts: buckets,
          };
          const key = [row.tenantId, row.serviceId, row.direction, row.method, row.route, row.statusCode, row.hour].join("\u0000");
          const existing = rows.get(key);
          if (existing && existing.requestCount + row.requestCount > ROW_CEILING) {
            skip("row total over the ceiling");
            continue;
          }
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
