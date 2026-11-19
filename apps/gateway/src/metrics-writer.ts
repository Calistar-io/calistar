/**
 * Private listener: receives the Collector's reduced output and writes hourly aggregates.
 *
 * Raw paths exist only in memory, between the request and `aggregate`. Nothing is written before
 * normalization, and nothing from the payload is logged.
 */
import { Hono } from "hono";

import { aggregate, type ExportMetricsRequest, type MetricRow } from "./otlp-metrics.ts";

export interface MetricsWriterOptions {
  write(rows: readonly MetricRow[]): Promise<void>;
}

export function metricsWriter({ write }: MetricsWriterOptions): Hono {
  const app = new Hono();

  app.post("/v1/metrics", async (c) => {
    let request: ExportMetricsRequest;
    try {
      request = (await c.req.json()) as ExportMetricsRequest;
    } catch {
      // Not retryable: the Collector must not resend a body that cannot be read.
      return c.json({ error: "body is not OTLP JSON" }, 400);
    }

    let rows: MetricRow[];
    let skipped: Record<string, number>;
    try {
      ({ rows, skipped } = aggregate(request));
    } catch {
      // A shape that is not an OTLP export. Not retryable.
      return c.json({ error: "body is not an OTLP metrics export" }, 400);
    }
    try {
      await write(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // PostgreSQL classes 22 (data exception) and 23 (constraint violation): the batch itself is
      // refused and would be refused again. Not retryable, or it would block the queue for good.
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && /^2[23]/.test(code)) {
        console.error("batch refused by the database, dropped:", code, message);
        return c.json({ error: "batch refused" }, 400);
      }
      // Anything else is an outage. Retryable: the Collector keeps the batch in memory and resends it.
      console.error("write failed:", message);
      return c.json({ error: "storage unavailable" }, 503);
    }

    const reasons = Object.entries(skipped);
    if (reasons.length > 0) {
      console.warn("data points skipped:", reasons.map(([reason, n]) => `${reason}: ${n}`).join("; "));
    }
    // OTLP success: an empty ExportMetricsServiceResponse.
    return c.json({});
  });

  return app;
}
