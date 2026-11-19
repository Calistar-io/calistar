/**
 * Calistar gateway. Two listeners:
 * - public: ingestion from tenants (OTLP for APIs, page views for web properties);
 * - private: the Collector's reduced output, on the internal network only.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { loadConfig } from "./config.ts";
import { createPool, migrate, upsertRows } from "./db.ts";
import { metricsWriter } from "./metrics-writer.ts";
import { otlpFront } from "./otlp-front.ts";
import { TokenRegistry } from "./tenants.ts";
import { webEvents } from "./web-events.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const tokens = TokenRegistry.fromFile(config.tenantsFile);

const applied = await migrate(pool);
if (applied.length > 0) console.log("migrations applied:", applied.join(", "));

const publicApp = new Hono();
publicApp.get("/healthz", (c) => c.text("ok"));
publicApp.route("/", otlpFront({ tokens, collectorUrls: config.collectorUrls, maxBodyBytes: config.maxBodyBytes }));
publicApp.route("/", webEvents({ umamiUrl: config.umamiUrl, trustedProxyHops: config.trustedProxyHops }));

const privateApp = new Hono();
privateApp.get("/healthz", async (c) => {
  try {
    await pool.query("SELECT 1");
    return c.text("ok");
  } catch {
    return c.text("database unreachable", 503);
  }
});
privateApp.route("/", metricsWriter({ write: (rows) => upsertRows(pool, rows) }));

const servers = [
  serve({ fetch: publicApp.fetch, port: config.publicPort, hostname: "0.0.0.0" }),
  serve({ fetch: privateApp.fetch, port: config.privatePort, hostname: "0.0.0.0" }),
];
console.log(`gateway: public :${config.publicPort}, private :${config.privatePort}, ${tokens.size} ingest token(s)`);

function shutdown(): void {
  for (const server of servers) server.close();
  void pool.end().finally(() => process.exit(0));
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
