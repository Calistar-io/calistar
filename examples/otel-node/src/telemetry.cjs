// OpenTelemetry setup for the example API. Loaded before the application:
//
//   node --require ./src/telemetry.cjs src/server.cjs
//
// It sends metrics, traces and logs to Calistar over OTLP/HTTP, with an ingest token. Calistar
// keeps the HTTP request-duration metrics only: traces and logs are accepted and dropped.
//
// A service that already exports to its own backend keeps that export as it is and adds this one
// as a second exporter.
"use strict";

const { OTLPLogExporter } = require("@opentelemetry/exporter-logs-otlp-proto");
const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-proto");
const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-proto");
const { HttpInstrumentation } = require("@opentelemetry/instrumentation-http");
const { BatchLogRecordProcessor } = require("@opentelemetry/sdk-logs");
const { PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");
const { NodeSDK } = require("@opentelemetry/sdk-node");

const endpoint = (process.env.CALISTAR_OTLP_ENDPOINT || "http://localhost:8080").replace(/\/+$/, "");
const headers = { authorization: `Bearer ${process.env.CALISTAR_INGEST_TOKEN || ""}` };

// Delta temporality is the recommended setup: Calistar then needs no state to count requests.
// The exporters read it from the standard variable.
process.env.OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE ||= "delta";

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME || "example-api",
  instrumentations: [
    new HttpInstrumentation({
      // The exporters' own requests to Calistar are not part of the service's traffic.
      ignoreOutgoingRequestHook: (request) => String(request.path || "").startsWith("/v1/"),
      // Neither are health checks.
      ignoreIncomingRequestHook: (request) => request.url === "/health",
    }),
  ],
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics`, headers }),
      exportIntervalMillis: Number(process.env.EXPORT_INTERVAL_MS || 5000),
    }),
  ],
  traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces`, headers }),
  logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter({ url: `${endpoint}/v1/logs`, headers }))],
});

sdk.start();

process.on("SIGTERM", () => {
  sdk.shutdown().finally(() => process.exit(0));
});
