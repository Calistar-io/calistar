// Short load run on the API path, with k6:
//
//   k6 run tests/load/api-ingest.js && node tests/load/verify-counts.mjs
//
// Workload: 50 exporters, each sending one OTLP export every 10 seconds. An export holds 40 data
// points, one per route, each standing for one request. That is 200 requests per second
// represented, or 17,280,000 per day: 17 times the RFP design target of 1,000,000 per day.
// Every exporter has its own routes, so the run writes 2,000 distinct hourly rows.
//
// This is a short run (10 minutes by default), not the one-hour test of the specification.
import exec from "k6/execution";
import http from "k6/http";
import { check } from "k6";

const GATEWAY_URL = __ENV.GATEWAY_URL || "http://127.0.0.1:8080";
const DURATION = __ENV.DURATION || "10m";
const EXPORTERS = 50;
const ROUTES = 40;
const EXPORT_INTERVAL_S = 10;
// Local test tokens of the two seed tenants (infra/compose/seed/tenants.json holds their digests).
const TOKENS = ["calistar-poc-token-tenant-a", "calistar-poc-token-tenant-b"];
// Lower-case letters only: no normalization rule matches it, so it can be found again.
const RUN_ID = __ENV.RUN_ID || `load${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 8)}`;

const BOUNDS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10];

export const options = {
  scenarios: {
    exporters: {
      executor: "constant-arrival-rate",
      rate: EXPORTERS / EXPORT_INTERVAL_S,
      timeUnit: "1s",
      duration: DURATION,
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    // Ingest latency, as the exporter sees it.
    "http_req_duration{expected_response:true}": ["p(99)<250"],
    checks: ["rate==1"],
    dropped_iterations: ["count==0"],
  },
};

function exportBody(exporter) {
  const now = `${Date.now()}000000`;
  const start = `${Date.now() - EXPORT_INTERVAL_S * 1000}000000`;
  const dataPoints = [];
  for (let route = 0; route < ROUTES; route++) {
    const buckets = BOUNDS.map(() => "0");
    buckets.push("0");
    buckets[route % BOUNDS.length] = "1";
    dataPoints.push({
      attributes: [
        { key: "http.request.method", value: { stringValue: "GET" } },
        { key: "http.route", value: { stringValue: `/${RUN_ID}/svc${exporter}/route${route}` } },
        { key: "http.response.status_code", value: { intValue: "200" } },
      ],
      startTimeUnixNano: start,
      timeUnixNano: now,
      count: "1",
      sum: 0.02,
      bucketCounts: buckets,
      explicitBounds: BOUNDS,
    });
  }
  return JSON.stringify({
    resourceMetrics: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: `svc${exporter}` } }] },
        scopeMetrics: [{ metrics: [{ name: "http.server.request.duration", unit: "s", histogram: { aggregationTemporality: 1, dataPoints } }] }],
      },
    ],
  });
}

export default function () {
  const exporter = exec.scenario.iterationInTest % EXPORTERS;
  const res = http.post(`${GATEWAY_URL}/v1/metrics`, exportBody(exporter), {
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKENS[exporter % TOKENS.length]}` },
  });
  check(res, { "export accepted": (r) => r.status === 200 });
}

export function handleSummary(data) {
  const metric = (name) => (data.metrics[name] ? data.metrics[name].values : {});
  const accepted = metric("checks").passes || 0;
  const summary = {
    runId: RUN_ID,
    duration: DURATION,
    exportsAccepted: accepted,
    exportsRefused: metric("checks").fails || 0,
    droppedIterations: metric("dropped_iterations").count || 0,
    requestsRepresented: accepted * ROUTES,
    distinctRoutes: EXPORTERS * ROUTES,
    ingestLatencyMs: {
      avg: metric("http_req_duration").avg,
      med: metric("http_req_duration").med,
      p95: metric("http_req_duration")["p(95)"],
      p99: metric("http_req_duration{expected_response:true}")["p(99)"],
      max: metric("http_req_duration").max,
    },
    thresholdsPassed: Object.values(data.metrics).every((m) => !m.thresholds || Object.values(m.thresholds).every((t) => t.ok)),
  };
  const line = (label, value) => `${label.padEnd(26)}${value}\n`;
  const text =
    line("run", summary.runId) +
    line("exports accepted", summary.exportsAccepted) +
    line("exports refused", summary.exportsRefused) +
    line("dropped iterations", summary.droppedIterations) +
    line("requests represented", summary.requestsRepresented) +
    line("ingest p95 (ms)", (summary.ingestLatencyMs.p95 || 0).toFixed(1)) +
    line("ingest p99 (ms)", (summary.ingestLatencyMs.p99 || 0).toFixed(1)) +
    line("thresholds passed", summary.thresholdsPassed);
  return { stdout: `\n${text}\n`, "tests/load/last-run.json": JSON.stringify(summary, null, 2) + "\n" };
}
