---
title: Architecture overview
description: The components of Calistar, how web events and API metrics travel through them, and the principles behind the design.
---

# Architecture overview

::: warning Draft
Calistar is a proposal answering the Stellar Community Fund RFP *Web and API Analytics for Stellar Ecosystem Projects*. No service is running yet, and details can change until the scope is approved. A [proof of concept](/architecture/proof-of-concept) checks the design on a developer machine.
:::

Calistar is a multi-tenant web and API analytics service for projects building on Stellar. It is designed to run as shared infrastructure for the Stellar Community Fund (SCF), and then to be handed to a community operator.

This page is the overview. The full [technical architecture](/architecture/technical-architecture) maps every RFP requirement to a component, an approach and a verification method.

## At a glance

- **Web analytics** come only from browsers, through a small version-pinned script. An unmodified, pinned release of [Umami](https://github.com/umami-software/umami) processes them and PostgreSQL stores them. No cookies, no device storage, no stored IP addresses.
- **API analytics** come from OpenTelemetry (OTLP) metrics that a project exports to Calistar in addition to its own backend. Traces, spans and logs are discarded in memory. Only HTTP request-duration histograms are kept, as hourly aggregates.
- **Projects** see their own data only. **SCF operators** compare the same standardized metrics across all enrolled projects.
- **Everything** lives in one open-source monorepo: application code, infrastructure as code, runbooks and tests.

## Data flow

![Data flow from a project's browser and backend, through the gateway, to Umami and PostgreSQL, then to the console and the Metrics API](/images/data-flow.svg)

**A web event** goes from the browser to the gateway, which truncates the IP address, strips every field outside an allow-list and runs the bot checks. It then reaches Umami, which writes it to its own database. A daily job reads Umami and stores per-property rollups for the operator view and the Metrics API. Projects read Umami's dashboard directly.

**An API metric** goes from the project's service to the gateway, which resolves the ingest token to a tenant. The Collector drops traces and logs and keeps HTTP duration histograms. The gateway then normalizes the route and merges the data points into hourly rows.

**An operator comparison** reads the rollup tables only.

## Components

| Component | Role | Origin |
| --- | --- | --- |
| Tracker | Browser script. Sends the site ID, hostname, URL path, referrer, a coarse screen class and its own version. Reads and writes no cookie and no storage. | Built from Umami's tracker source, with a reduced profile |
| Gateway | The only public entry point for ingestion. It holds no data. | Written for Calistar (TypeScript) |
| OpenTelemetry Collector | Drops traces and logs, keeps HTTP request-duration histograms. | Upstream image, configuration only |
| Umami | Processes web events and serves the project's web dashboard. | Upstream release, unmodified |
| PostgreSQL | Two databases in one cluster: Umami's own, and Calistar's control plane and metrics. | Plain PostgreSQL, no extension required |
| Console | Enrollment, the project's API dashboard, the operator's global view, and single sign-on to Umami's dashboard. | Written for Calistar (Next.js) |
| Metrics API | Read-only and versioned, with keys issued by operators. Served by the console. | Written for Calistar |
| Scheduled jobs | Daily rollups, retention deletes, integrity check of the served script. | Run from the gateway image |

The three gateway boxes in the diagram are one deployed service, with a public listener and a private one.

## Design principles

1. **Reduce at the door.** Data the service must not hold (IP addresses, traces, logs, identifiers, raw paths) is removed in memory at ingestion, before any write.
2. **Stock components, unmodified.** No Umami fork and no custom Collector build. Calistar-specific behavior sits in front of them (the gateway) or beside them (the console).
3. **One database technology.** PostgreSQL only. No queue, cache or column store that a future operator must also learn.
4. **Ingestion is independent of dashboards.** The ingest tier does not depend on the console and keeps accepting data during a console outage.
5. **Isolation enforced below the console.** A console bug alone must not expose another project's data. See [Security](/security/).

## Why Umami

The RFP asks for a service built on Umami or GoatCounter. Calistar uses Umami for two reasons: its native metrics cover the seven web metrics the RFP requires, and its teams and read-only roles isolate projects inside Umami itself, so projects can use its dashboard directly.

## Scope limits

These items are left out of the first version. Each can be added later without changing stored data or published tracker versions.

- Custom events, and automatic capture of Stellar Wallets Kit events.
- OTLP over gRPC. OTLP over HTTP is supported by every OpenTelemetry SDK and keeps a single authenticated entry point.
- Metrics derived from spans. Projects export HTTP metrics, which standard instrumentation already emits.
- Erasure by time range. Deleting a whole property or a whole project is provided.

Calistar does not use the ledger: no smart contract and no on-chain write. It is infrastructure for projects that do.

## Repository layout

This is the planned layout. Today the repository holds the landing page, this documentation and a [proof of concept](/architecture/proof-of-concept): a first gateway, the path normalizer, the local stack, two examples and the stack tests. The console, the tracker build and the infrastructure as code are not written yet.

```text
apps/        console/  gateway/  landing/  docs/
packages/    tracker/  normalizer/  config/
infra/       tofu/  compose/  collector/  monitoring/
examples/    static-html/  react-spa/  nextjs-ssr/  otel-node/  otel-collector-dual-export/
tests/       e2e/  isolation/  abuse-corpus/  load/
```

Umami and the Collector are consumed as container images pinned by digest. They are not copied into the repository.
