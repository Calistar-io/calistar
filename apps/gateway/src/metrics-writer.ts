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

    const { rows, skipped } = aggregate(request);
    try {
      await write(rows);
    } catch (error) {
      // Retryable: the Collector keeps the batch in its in-memory queue and sends it again.
      console.error("write failed:", error instanceof Error ? error.message : error);
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
