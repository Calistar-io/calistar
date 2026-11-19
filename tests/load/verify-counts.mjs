// After `k6 run tests/load/api-ingest.js`: checks that what is stored equals what was sent.
//
//   node tests/load/verify-counts.mjs
//
// It reads tests/load/last-run.json, written by the k6 script, and asks PostgreSQL for the sum of
// the request counts of that run's routes. No data loss means the two numbers are equal.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SUMMARY = fileURLToPath(new URL("./last-run.json", import.meta.url));
const COMPOSE = fileURLToPath(new URL("../../infra/compose/compose.yaml", import.meta.url));

const summary = JSON.parse(readFileSync(SUMMARY, "utf8"));
if (!/^[a-z]+$/.test(summary.runId)) throw new Error(`unexpected run id: ${summary.runId}`);

function stored() {
  const sql = `SELECT coalesce(sum(request_count), 0), count(*), count(DISTINCT route) FROM api_metric_1h WHERE route LIKE '/${summary.runId}/%'`;
  const out = execFileSync(process.env.DOCKER || "docker", ["compose", "-f", COMPOSE, "exec", "-T", "postgres", "psql", "-U", "calistar", "-d", "calistar", "-Atc", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const [requests, rows, routes] = out.trim().split("|").map(Number);
  return { requests, rows, routes };
}

// The Collector forwards asynchronously: give the last batches time to land.
let result = stored();
for (let attempt = 0; attempt < 30 && result.requests < summary.requestsRepresented; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  result = stored();
}

const ok = result.requests === summary.requestsRepresented && result.routes === summary.distinctRoutes;
writeFileSync(SUMMARY, `${JSON.stringify({ ...summary, storedRequests: result.requests, storedRows: result.rows, storedRoutes: result.routes, countsMatch: ok }, null, 2)}\n`);

console.log(`requests represented  ${summary.requestsRepresented}`);
console.log(`requests stored       ${result.requests}`);
console.log(`distinct routes       ${result.routes} of ${summary.distinctRoutes}`);
console.log(`hourly rows           ${result.rows}`);
console.log(ok ? "OK: stored equals sent" : "MISMATCH");
process.exit(ok ? 0 : 1);
