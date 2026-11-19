// Example API: a few routes, one of which carries a Stellar account in its path.
"use strict";

const http = require("node:http");
const { context } = require("@opentelemetry/api");
const { logs } = require("@opentelemetry/api-logs");
const { getRPCMetadata, RPCType } = require("@opentelemetry/core");

const logger = logs.getLogger("example-api");
const port = Number(process.env.PORT || 8090);

/**
 * Sets the route of the current request. A web framework does this with the route template
 * (`/accounts/:id`). This example passes the raw path on purpose, as a naive service would:
 * Calistar replaces the account by a placeholder before anything is stored.
 */
function setRoute(route) {
  const metadata = getRPCMetadata(context.active());
  if (metadata?.type === RPCType.HTTP) metadata.route = route;
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  setRoute(pathname);
  // A log record with request details: sent to Calistar, where logs are dropped.
  logger.emit({ severityText: "INFO", body: `request ${req.method} ${req.url}` });

  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (pathname === "/health") return json(200, { ok: true });
  const account = /^\/accounts\/([^/]+)\/payments$/.exec(pathname);
  if (account) return json(200, { account: account[1], payments: [] });
  if (pathname === "/slow") return void setTimeout(() => json(200, { ok: true }), 300);
  if (pathname === "/fail") return json(500, { error: "example failure" });
  return json(404, { error: "not found" });
});

server.listen(port, () => console.log(`example API on :${port}`));
process.on("SIGTERM", () => server.close());
