/**
 * Public OTLP entry point: `/v1/metrics`, `/v1/traces`, `/v1/logs` over HTTP, protobuf or JSON.
 *
 * The gateway authenticates the ingest token, then forwards the body to the Collector without
 * parsing it. The tenant and the service travel as request headers that only the gateway sets:
 * nothing the caller sends can choose them.
 */
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import type { IngestBinding, TokenRegistry } from "./tenants.ts";

export const TENANT_HEADER = "x-calistar-tenant";
export const SERVICE_HEADER = "x-calistar-service";

const SIGNALS = ["metrics", "traces", "logs"] as const;

/** Request headers passed on to the Collector. Everything else stops here, the bearer token included. */
const FORWARDED_HEADERS = ["content-type", "content-encoding"];

export interface OtlpFrontOptions {
  tokens: TokenRegistry;
  collectorUrls: readonly string[];
  maxBodyBytes: number;
  fetch?: typeof fetch;
}

/**
 * Orders the Collector replicas for a binding, by rendezvous hashing: a given tenant and service
 * always reach the same replica first, and move to the next one only when it fails. The
 * Collector keeps state per stream, so a stream must not be spread over replicas.
 */
export function replicaOrder(binding: IngestBinding, collectorUrls: readonly string[]): string[] {
  const weight = (url: string) => createHash("sha256").update(`${binding.tenantId}\u0000${binding.serviceId}\u0000${url}`).digest("hex");
  return [...collectorUrls].sort((a, b) => (weight(a) < weight(b) ? 1 : -1));
}

export function otlpFront({ tokens, collectorUrls, maxBodyBytes, fetch: doFetch = fetch }: OtlpFrontOptions): Hono {
  const app = new Hono();

  for (const signal of SIGNALS) {
    app.post(
      `/v1/${signal}`,
      bodyLimit({ maxSize: maxBodyBytes, onError: (c) => c.json({ error: "payload too large" }, 413) }),
      async (c) => {
        const binding = tokens.resolve(c.req.header("authorization"));
        if (!binding) return c.json({ error: "invalid or missing ingest token" }, 401);

        const headers = new Headers();
        for (const name of FORWARDED_HEADERS) {
          const value = c.req.header(name);
          if (value) headers.set(name, value);
        }
        headers.set(TENANT_HEADER, binding.tenantId);
        headers.set(SERVICE_HEADER, binding.serviceId);

        const body = await c.req.arrayBuffer();
        let lastError: unknown;
        for (const collector of replicaOrder(binding, collectorUrls)) {
          try {
            const upstream = await doFetch(`${collector}/v1/${signal}`, { method: "POST", headers, body });
            // The Collector's answer is the answer: partial success and back-pressure reach the SDK.
            return new Response(upstream.body, {
              status: upstream.status,
              headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
            });
          } catch (error) {
            // Connection error: this replica is down. A request that was answered is never retried.
            lastError = error;
          }
        }
        console.error("no Collector replica reachable:", lastError instanceof Error ? lastError.message : lastError);
        return c.json({ error: "ingestion temporarily unavailable" }, 503);
      },
    );
  }

  return app;
}
