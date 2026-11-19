---
title: Technical architecture
description: The technical architecture of Calistar, a multi-tenant, privacy-first web and API analytics service for Stellar projects, with the RFP requirements it answers.
outline: [2, 2]
---

# Technical architecture

::: warning Proposal
This is the architecture document of a proposal. It answers the Stellar Community Fund RFP *Web and API Analytics for Stellar Ecosystem Projects* (SCF #46). No service is hosted yet. Where a point was checked on running software, the text says "proof of concept" and gives the date; the [proof of concept](/architecture/proof-of-concept) page has the tests and their results.
:::

Version of 2026-11-19. The design is sized for one maintainer and three months of development.

## 1. Executive overview

Calistar is a multi-tenant web and API analytics service for projects building on Stellar, designed to be run by the Stellar Community Fund (SCF) as shared infrastructure and handed to a community operator.

- **Web analytics** are collected only from browsers by a small, version-pinned script, processed by an unmodified, pinned release of [Umami](https://github.com/umami-software/umami), and stored in PostgreSQL. No cookies, no device storage, no stored IP addresses.
- **API analytics** are produced from OpenTelemetry (OTLP) metrics that tenants dual-export. A stock OpenTelemetry Collector discards traces, spans and logs in memory and keeps HTTP request-duration histograms. A gateway binds each export to a tenant, normalizes paths (including Stellar addresses) and writes hourly aggregates to PostgreSQL.
- **Tenants** see only their own data. **SCF operators** get a global view that compares the same standardized metrics across all enrolled projects, plus revocable API keys for machine consumers.
- **Everything** — application code, infrastructure-as-code, runbooks, tests — lives in one open-source monorepo, so a community operator can rebuild the service from scratch.

Plain-English stack: a Next.js console, one TypeScript gateway in front of Umami and the Collector, the upstream OpenTelemetry Collector used through configuration only, one PostgreSQL cluster, and OpenTofu plus containers for infrastructure.

The service is built and operated by one maintainer. The design therefore prefers stock, widely used components over custom ones: Umami's own dashboard for tenant web analytics, the upstream Collector without custom plugins, plain PostgreSQL. This also keeps the handover small: the future operator inherits two TypeScript applications and configuration, not a fork or a custom Collector build.

Calistar is off-chain infrastructure. It has no smart contracts and does not write to the Stellar ledger. Its Stellar-specific parts are listed in §6 and are deliberately limited to what the RFP asks for.

## 2. RFP requirements and scope

### 2.1 Scope statement

The proposal addresses every mandatory requirement of the RFP. The two nice-to-haves and several items that go beyond the RFP's minimum are deferred; §2.3 lists each one with the reason.

### 2.2 Requirement traceability

Requirement IDs are internal to this document; the text is paraphrased from the RFP section given. "Verification" is what a reviewer can run or inspect.

#### General (RFP §3.1)

| ID | Requirement | Component | Approach | Verification |
|---|---|---|---|---|
| G1 | Multi-tenant; teams register sites, properties, APIs | Console, control-plane DB | A tenant owns web properties and API services. Each tenant maps to one Umami team and one set of ingest tokens (§5.5) | E2E test: two tenants enroll and register a site and an API |
| G2 | Strict isolation; SCF operators hold the global view | Umami teams, PostgreSQL row-level security, console authorization | Web data is isolated by Umami's own team membership; API data by row-level security; the console checks the tenant on every request (§7.3) | Cross-tenant access test suite run in CI on every change; results published |
| G3 | Self-service enrollment; operators can remove projects; later switch to approval-required | Console, control-plane DB | Enrollment mode is a runtime setting (`open` / `approval`); removal suspends ingestion and access immediately (§5.5) | E2E tests for both modes and for removal; operator runbook |
| G4 | OSI-approved license for all code | Monorepo | Single license at repo root: Apache-2.0 (decided 2026-11-19); Umami is MIT | License file; automated license scan of dependencies in CI |
| G5 | Single monorepo including IaC | Monorepo | Layout in §5.9 | Repository inspection; recorded rebuild rehearsal (§9.5) |
| G6 | Zero fees | — | No billing code, no paid tiers, no usage limits tied to payment | Repository inspection; terms of service |
| G7 | Operators generate and revoke API keys for machine access to metrics | Metrics API | Hashed, scoped, revocable keys (§5.7) | API test: create key, read metrics, revoke, confirm `401` |
| G8 | Proposer known to SCF | — | Team section of the submission | SCF records |

#### Web analytics (RFP §3.2)

| ID | Requirement | Component | Approach | Verification |
|---|---|---|---|---|
| W1 | Events only from frontend code; bot and inflation mitigation | Gateway, tracker | Three layers on top of Umami's user-agent check, covering both behaviours the RFP names (§5.2) | Published abuse corpus (curl, server-side HTTP clients, real browsers) with expected accept/quarantine outcome, run in CI |
| W2 | Low-friction integration: static HTML, SPA, SSR | Tracker | One `<script>` tag; automatic SPA route tracking | Example apps in the monorepo (static, React SPA, Next.js SSR) with Playwright tests |
| W3 | Pinned script version; no dynamic remote updates | Tracker, gateway | Immutable versioned URLs with Subresource Integrity hashes (§5.1) | Synthetic check compares served bytes to the published hash manifest |
| W4 | Supply-chain defense | CI/CD, tracker, infra | §7.4 | SBOM, signed artifacts, provenance attestations attached to each release |
| W5 | Minimum metrics: page views, unique visitors, referrers, session duration, bounce rate, country, device/browser | Umami | Native Umami metrics | Metric-accuracy test replaying a known event set |
| W6 | Nice-to-have: custom events; automatic Stellar Wallets Kit events | — | Deferred (§2.3) | — |
| W7 | Names that do not trigger popular ad blockers | Tracker, gateway | Neutral script and endpoint names on a neutral host (§5.1) | CI job matching all public URLs against EasyList, EasyPrivacy, AdGuard and uBlock filter lists |
| W8 | GDPR-compliant without opt-in; jurisdictions, residency, erasure, documented strategy | Gateway, Umami config, console, docs | §7.1–7.2 | Privacy and compliance document; deletion E2E test; storage-free tracker test |
| W9 | Tenant web dashboard, selectable time ranges, own data only | Umami UI, console | Tenants open Umami's own dashboard from the console, signed in as a view-only member of their team only (§5.5) | E2E test; isolation suite; test that a tenant user cannot edit, reset or delete a site |
| W10 | Global operator dashboard: filter, sort, side-by-side comparison | Console, daily rollups | Console view over daily per-property rollups (§5.6, §5.8) | E2E test; live operator view |

#### API analytics (RFP §3.3)

| ID | Requirement | Component | Approach | Verification |
|---|---|---|---|---|
| A1 | Tenants dual-export standard OpenTelemetry data to their own backend and the SCF collector | Gateway, Collector, docs | OTLP over HTTP; documented dual-export configurations for an SDK and for a tenant-side Collector | Example services exporting to a local backend and to Calistar simultaneously |
| A2 | Drop traces, spans, deep logs; keep counters and histograms; write to PostgreSQL | Collector, gateway | Trace and log pipelines end in the stock `nop` exporter; only HTTP duration histograms continue (§5.3) | Test sends traces, logs and metrics, then asserts that only aggregate rows exist in PostgreSQL and nothing else is written to disk |
| A3 | Attributes: tenant/service, normalized route, status code, latency | Gateway, DB schema | §5.2–5.4 | Schema inspection; ingestion test |
| A4 | Hard-coded default path normalization incl. Stellar G/C/M addresses | `packages/normalizer` | Ordered rule set (§6.1) | Golden-file test corpus; Stellar keys generated with the official SDK |
| A5 | Design target ≈ 1,000,000 requests/day across tenants | Gateway, Collector, PostgreSQL | Aggregation at ingest keeps storage proportional to routes, not requests (§8.3) | Published load test at ≥ 10× target |
| A6 | Aggregates retained ≥ 24 months | PostgreSQL, scheduled jobs | Hourly rows kept 25 months; daily rollups kept indefinitely | Retention job test; documented retention table |
| A7 | Same isolation as web | Gateway, row-level security | `tenant.id` is bound to the ingest credential and never read from the payload | Spoofing test: a payload claiming another tenant is attributed to the token's tenant |
| A8 | Tenant API dashboard: volume, status distribution, p50/p95, time ranges | Console | Histogram-based percentiles (§5.4) | E2E test; percentile accuracy test |
| A9 | Global API dashboard | Console | Same rollup tables, operator role | E2E test; live operator view |

#### Hosting, support and handover (RFP §3.4)

| ID | Requirement | Component | Approach | Verification |
|---|---|---|---|---|
| H1 | 12 months hosting and support after final tranche approval | Operations | §9 | Public status page with history |
| H2 | Operational targets | Infra, operations | Commitments sized for one maintainer, and how the design supports them (§9.3) | Externally measured availability, published monthly |
| H3 | Public issue tracker is sufficient | GitHub | Issue templates, security policy, labels with response-time tracking | Repository |
| H4 | Handover: repo transfer, full data migration, domain transfer or permanent redirect; rebuild from monorepo | IaC, runbooks | Handover kit and rebuild rehearsal (§9.5) | Recorded rebuild into an empty cloud project using the documentation only |

#### Expected deliverables (RFP §5) and track rules

| ID | Requirement | Where addressed |
|---|---|---|
| D1 | Functional multi-tenant web + API platform | Whole document |
| D2 | Monorepo with code, IaC, deployment docs, runbooks, onboarding guide, tests, security/privacy docs, monitoring baseline | §5.9, §8, §9 |
| D3 | Live adoption: ≥ 3 SCF-awarded projects on web, ≥ 1 on API, live operator view, tenant screen-capture video | Delivery plan, tranche 3 |
| D4 | Explicit statements on residency, jurisdictions, erasure | §7.1–7.2 |
| T1 | Diagram and plain-English stack | §1, §4 |
| T2 | Decentralization explanation | §10.4 |
| T3 | Infrastructure description | §9.1 |
| T4 | User-tracking plans and protections | §7.1 |
| T5 | Latest stable Stellar stack; license; building in the open; community updates | §6, §10 |

### 2.3 Scope limits and deferred items

The RFP track allows a limited scope when the reasoning is given. Nothing below is a mandatory RFP requirement. Each item can be added later without changing stored data or published tracker versions.

| Deferred item | Reason |
|---|---|
| Custom events; automatic Stellar Wallets Kit capture (W6) | RFP nice-to-haves. The budget is sized for the mandatory scope. The tracker payload is versioned, so both can be added without breaking installed snippets |
| OTLP over gRPC | Every OpenTelemetry SDK and the Collector's `otlphttp` exporter support OTLP over HTTP. One protocol keeps a single authenticated entry point |
| Metrics derived from spans | The RFP says spans are dropped. Standard HTTP instrumentation already emits request-duration metrics. Deriving metrics from spans needs the `span_metrics` connector, which is alpha upstream, and a rule against double counting. The onboarding guide states that HTTP metrics must be exported |
| Tenant web dashboard rendered by the console | Umami's own dashboard already shows the seven required metrics with time ranges. Rebuilding it adds cost and no data |
| Hosting-network and automation signals; statistical anomaly flags | Beyond the two behaviours the RFP names. Quarantine ratios are already visible to operators |
| Erasure by time range | Deletion of a whole property or tenant is provided. Time-range deletion needs direct writes to Umami's tables |
| Tracker as an npm package | The script tag with an integrity hash works for static, SPA and SSR sites |
| One-minute API granularity; on-disk export queue | Hourly aggregates answer the RFP's dashboards. An in-memory retry queue covers short database interruptions (§8.3) |
| Permanent staging environment | The same modules create a second environment on demand |
| Review by a second engineer; third-party rebuild rehearsal | One maintainer. Compensating controls are in §7.4 and §9.5 |

## 3. Existing infrastructure and identified gaps

### 3.1 What exists

- **Self-reported metrics.** SCF reviewers currently rely on numbers that teams report themselves (RFP §2).
- **Per-project analytics.** Teams run their own Google Analytics, Plausible, Umami, PostHog or nothing. Data is not comparable and not verifiable by SCF.
- **On-chain and ecosystem dashboards.** These show which projects exist and what happens on the ledger, not whether a web app or an API is used.
- **Base projects.** Umami and GoatCounter are single-operator analytics tools. Neither offers self-service enrollment for independent organizations, a cross-tenant comparison view, anti-inflation controls suited to funding decisions, or API analytics.
- **OpenTelemetry.** The Collector has no stock PostgreSQL exporter (checked against the `opentelemetry-collector-contrib` exporter list, 2026-11-18) and no built-in way to bind a tenant to a per-tenant credential.

### 3.2 Gaps Calistar fills

1. A neutral operator and a shared, comparable metric definition.
2. Collection that is hard to inflate, because the data informs funding decisions.
3. Tenant isolation with a privileged, audited operator view.
4. API usage metrics without receiving tenants' traces or logs.
5. A handover path: everything needed to run the service is public.

### 3.3 Base project choice: Umami

The RFP requires Umami or GoatCounter. Facts below were checked against each project's repository on 2026-11-18.

| Criterion | Umami (v3.5.0, 2026-11-12) | GoatCounter (v2.7.0, 2025-12-15) |
|---|---|---|
| License | MIT | EUPL 1.2 "slightly modified" (copyleft); `count.js` is ISC |
| Language / runtime | TypeScript, Node.js ≥ 20.19 | Go |
| Database | PostgreSQL ≥ 12.14 | SQLite or PostgreSQL |
| Organizations and roles | Teams; roles `team-owner`, `team-manager`, `team-member`, `team-view-only`; global `admin` | Not described in the project README (not checked further) |
| Required metrics | All seven in W5; its `getWebsiteStats` query returns page views, visitors, visits, bounces and total time | Documentation describes visit counting; no session-duration or bounce-rate reporting was found in its documentation (not checked further) |
| Visitor identification | Salted hash of site, IP, user agent; salt rotates (configurable); IP not stored | In-memory session map for 8 hours; IP and user agent never stored |
| Bot handling | `isbot` user-agent check | Ignores self-identified bots |
| Configurable script and endpoint names | Yes (`TRACKER_SCRIPT_NAME`, `COLLECT_API_ENDPOINT`) | Script served as `count.js` |
| Pinned script versions | Not built in | Yes, versioned files with SRI hashes |
| Maintainers | Several active (top three: 4,124 / 1,273 / 434 commits) | One (2,137 commits; next contributor: 4) |

**Decision: Umami.** Reasons, in order of weight:

1. **RFP metrics.** Umami reports session duration and bounce rate natively. With GoatCounter these would have to be built.
2. **Tenant model.** Umami's teams and read-only roles isolate tenants inside the base project itself, so tenants can use its dashboard directly.
3. **License.** MIT places no constraint on the monorepo license. GoatCounter's modified EUPL raises a question about "OSI-approved" that reviewers should not have to resolve.
4. **Maintenance risk.** A base project with a single maintainer is a risk for a service that must outlive its original operator.
5. **Stack fit.** Same language and database as the rest of the platform.

What GoatCounter does better, and what Calistar takes from it: versioned script files with SRI hashes (adopted in §5.1) and a stricter privacy default (matched in §7.1 by truncating IPs and using a salt that is destroyed daily).

Umami risks to manage: it ships features that conflict with a privacy-first service (session replay, heatmaps, visitor identification, city-level location). Their data is blocked at the gateway and never reaches Umami (§5.2, §7.1).

## 4. Proposed system architecture

![Data flow from a project's browser and backend, through the gateway, to Umami and PostgreSQL, then to the console and the Metrics API](/images/data-flow.svg)

In production a reverse proxy sits in front of the gateway and of Umami's dashboard, and is the only public entry point (§5.5).

The three gateway boxes are one deployable TypeScript service with a public listener and a private one.

Design principles:

1. **Reduce at the door.** Data the service must not hold (IP addresses, traces, logs, identifiers, raw paths) is removed in memory in the ingest tier, before any write.
2. **Stock components, unmodified.** No Umami fork and no custom Collector build. Calistar-specific behavior sits in front of them (gateway) or beside them (console).
3. **One database technology.** PostgreSQL only, as the RFP requires for API metrics. No queue, cache or column store that a future operator must also learn. Redis is optional and off by default.
4. **Ingestion is independent of dashboards.** The ingest tier has no dependency on the console and continues to accept data during a console outage.
5. **Isolation enforced below the console.** A console bug alone must not expose another tenant's data: Umami's team membership guards web data and row-level security guards API data.

### 4.1 Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **Chosen** | Unmodified Umami for collection and for the tenant web dashboard; console for enrollment, API dashboards and the operator view; stock Collector between two gateway stages | Least code to write and to hand over. Tenants see two interface styles. Umami's menus still show features whose data is blocked (they stay empty). Single sign-on passes a token through a URL (§5.5) |
| A | Console renders every dashboard from Umami's API | One interface. A second implementation of what Umami already shows, to build and maintain |
| B | Fork Umami and add enrollment, global view and API analytics inside it | Fastest first demo. Permanent merge burden against a fast-moving upstream; the future operator inherits a fork |
| D | Custom Collector distribution in Go (tenant authentication, route normalization and PostgreSQL export as plugins) | A single binary on the API path. Custom Go code to maintain next to a TypeScript codebase, and a build to keep in step with upstream |

## 5. Core components and responsibilities

### 5.1 Tracker (`packages/tracker`)

- Built from the Umami tracker source at a pinned tag (MIT), with a Calistar build profile:
  - no reads or writes of cookies, `localStorage` or `sessionStorage` (upstream reads `localStorage` for an opt-out flag; removed);
  - no session replay, heatmap, error or web-vitals collection;
  - no visitor identification (`identify`) and no custom event data;
  - sends only: site ID, hostname, URL path, referrer, coarse screen class, tracker version.
- **Distribution.** Hosted file at an immutable URL: `https://<neutral-host>/<neutral-name>/v<semver>/<file>.js`, served with `Cache-Control: immutable`. The documented snippet includes the `integrity` (SRI) attribute, so a browser refuses a modified file.
- **Upgrades are intentional.** A new version is a new URL and a new hash. There is no `latest` URL. New versions are announced in the changelog and on the console's snippet page.
- **Compatibility contract.** The gateway accepts every tracker version ever published; the event payload is versioned.
- **Naming.** Script, path and host names are chosen to avoid filter-list matches and are tested against the lists in CI (W7). The host is a dedicated domain, separate from `calistar.io`, registered before tranche 1.
- **No tenant-side proxying.** Events must reach Calistar directly from the browser. A tenant-operated proxy would let a tenant alter its own numbers, which defeats the purpose of SCF-trusted data.

### 5.2 Gateway (`apps/gateway`)

One small TypeScript service. It is the only public entry point for ingestion, and it holds no data.

#### Web events

**Data minimization, before Umami sees the request**

- Truncates the client IP (IPv4 to /24, IPv6 to /48). Umami then derives country and the visitor hash from the truncated address only. Checked on Umami v3.5.0 (proof of concept, 2026-11-19): Umami takes the address from the event's `ip` field when one is present, without any condition, so the gateway sets that field and removes any value the caller sent. The same holds for the user agent. This is also why Umami must never be reachable directly (§5.5).
- Uses a country-level GeoIP database, so region and city cannot be derived. Umami's stock image ships a city-level database and stores region and city from the truncated address (found in the proof of concept, 2026-11-19), so the deployment supplies a country-level one through `GEOLITE_DB_PATH`. **Open risk:** this replacement is not tested yet (§11).
- Applies a field allow-list to the payload; strips identifiers, titles, language, free-form event data.
- Injects a random salt that is generated daily and destroyed at rotation. Umami mixes it into the visitor hash (`ENABLE_CLIENT_SALT`). The salt lives only in the provider's secret manager and in gateway memory — never in PostgreSQL, logs or backups — so once it is destroyed, hashes can no longer be recomputed from an IP address and user agent, including by the operator.

**Bot and inflation mitigation (W1)**

| Layer | What it does | What it does not do |
|---|---|---|
| L0 | Umami's `isbot` user-agent check | Catch bots that lie about their user agent |
| L1 Provenance | Requires an `Origin` matching a verified domain of the site ID; checks browser fetch-metadata headers for consistency with the user agent | Stop a client that forges headers |
| L2 Script execution | The tracker obtains a short-lived signed token bound to site, truncated IP and user-agent hash, and returns it with a value computed in the page. Events without a valid token are quarantined | Stop headless browsers. It separates "a JavaScript engine ran the tracker" from "a server posted JSON", which is the RFP's minimum |
| L3 Fingerprint diversity per IP | In-memory sliding window keyed by a keyed hash of the truncated IP: many distinct fingerprints from one address in a short window are quarantined above a threshold | Penalize ordinary shared networks below the threshold. Keys expire within 24 hours and are never written to disk. Windows are per gateway replica; thresholds account for that |

- Accepted events go to Umami. Quarantined events are only counted, per property, day and reason.
- Tenants see their accepted traffic. Operators also see each property's quarantine ratio.
- Thresholds are configuration, published in the repository, and tuned against the abuse corpus.

No layer is claimed to be unbeatable. The goal is to make inflation expensive and visible.

#### OTLP front

- Accepts OTLP over HTTP (`/v1/metrics`, `/v1/traces`, `/v1/logs`; protobuf or JSON) with a bearer ingest token.
- Resolves the token to a tenant and service, removes any tenant header sent by the client, and forwards the request body unparsed, over the private network, to the Collector replica assigned to that token (§5.3), with the resolved tenant and service as request headers.
- Rate-limits per token.

#### Metrics writer

- Private listener that receives the Collector's reduced output: HTTP duration histograms only, delta temporality, tenant and service already stamped.
- Applies the path normalization rules (§6.1) and a per-service route cardinality cap with an overflow bucket.
- Maps current and legacy attribute names to one schema and merges data points into hourly rows with additive upserts.
- Raw paths exist only in memory between the two gateway stages. Nothing is written before normalization.
- Delivery from the Collector is at-least-once: a batch retried after a lost acknowledgement can be counted twice. Retries happen only on connection errors inside the private network; the limit is documented.

### 5.3 OpenTelemetry Collector (`infra/collector`)

The upstream `opentelemetry-collector-contrib` image, pinned by digest, with configuration only. No custom components.

```text
receivers:  otlp (HTTP, private network only, request metadata kept)

traces  : otlp -> nop
logs    : otlp -> nop
metrics : otlp -> memory_limiter
               -> filter             (keep HTTP request-duration histograms only)
               -> attributes         (tenant.id, service from request metadata; overwrite)
               -> cumulative_to_delta
               -> otlp_http          (to the gateway's metrics writer; in-memory queue, retry)
```

- **Traces and logs are never exported.** Both pipelines end in the stock `nop` exporter. No trace or log exporter exists in the configuration, and the Collector has no persistent storage.
- **Tenant binding.** The stock `attributes` processor copies the tenant from request metadata set by the gateway (`from_context`, documented upstream). Any `tenant.id` in the payload is overwritten.
- **Accepted inputs.** `http.server.request.duration` (current stable semantic convention), `http.client.request.duration`, and the legacy `http.server.duration` / `http.client.duration` names. The RFP names `http.client.duration` "or equivalent"; server-side duration is what describes usage of a tenant's API, so it is the default in dashboards, and client-side data is stored with a `direction` label.
- **State and replicas.** `cumulative_to_delta` remembers the previous value of each stream, so a stream must always reach the same Collector instance (upstream statefulness warning). The gateway therefore routes each ingest token to one Collector replica by consistent hash. When a replica fails, its tokens move to the other one, and the first data point of a moved stream serves only as a baseline: a failover can undercount one export interval but must never double count. Checked in the proof of concept (2026-11-19, Collector 0.165.0, where the processor is named `cumulative_to_delta`): `initial_value: drop` gives this behaviour on one replica, at the cost of the interval between the first two points of every new cumulative stream. The default, `auto`, would count a moved stream in full. **Open risk:** failover between two replicas is not tested yet (§11). The tenant must be stamped before this processor: its state is kept per stream, a stream is identified by its attributes, and two tenants sending the same stream would otherwise share a state.
- **Recommended tenant setup** is metrics-only export to Calistar with delta temporality, which needs no state on the Calistar side. Cumulative streams are accepted and converted. Traces and logs are accepted because the RFP requires it, and dropped.
- The exact configuration is in `infra/collector/config.yaml` and passes the Collector's own validation (proof of concept, 2026-11-19). Exponential histograms are dropped by the filter: services must export explicit-bucket histograms, the SDK default. The Collector's `transform` processor has a conversion function, not tested.
- The Collector passes a repeated attribute key through: it stamps one `tenant.id` and leaves a second one in place. The metrics writer therefore refuses any data point that repeats a key (proof of concept, 2026-11-19).

### 5.4 Data model (PostgreSQL)

Two databases in one cluster, separate roles:

- `umami` — owned and migrated by Umami. Calistar never writes to it directly; provisioning and deletion go through Umami's API.
- `calistar` — control plane and all Calistar-owned metrics.

Main `calistar` tables:

| Table | Content | Retention |
|---|---|---|
| `tenant`, `tenant_member`, `web_property`, `api_service` | Control plane | Life of tenant |
| `ingest_token`, `api_key` | Hashed credentials with prefix, scope, last use, revocation | Until revoked + audit period |
| `api_metric_1h` | tenant, service, direction, method, route, status code, hour, request count, duration sum, duration bucket counts | 25 months |
| `api_metric_1d` | Daily rollup of the above | Indefinite |
| `web_metric_1d`, `web_dim_1d` | Per property and day: page views, visitors, visits, bounces, total duration; top referrers, countries, browsers, devices | Indefinite |
| `ingest_reject_1d` | Quarantine counts by property, day, reason | 25 months |
| `audit_log` | Operator and security-relevant actions | 25 months |

- Plain tables with time indexes; retention by scheduled delete. No extension is required, so any managed PostgreSQL works. Partitioning is not needed at the RFP's design volume.
- **Percentiles.** Duration is stored as counts in fixed buckets (the OpenTelemetry default HTTP boundaries, 5 ms to 10 s). Histograms sent with other boundaries are mapped to these by upper bound. p50 and p95 are interpolated from merged buckets. This allows correct aggregation across time and services; accuracy is bounded by bucket width and is documented in the dashboard.
- Raw Umami events are not pruned in the first version; long-range and cross-project comparisons read the daily rollups.

### 5.5 Enrollment and tenancy

1. A user signs in to the console and creates a tenant (project name, SCF project or submission URL, contact).
2. For each web property, the tenant proves control of the domain (DNS TXT record or a file under `/.well-known/`).
3. The console provisions, through Umami's API with an administrator credential, a team and a website in that team. For each console user of the tenant it creates an Umami user with the global role `view-only`, added to that team only with the role `team-view-only`. Checked on Umami v3.5.0 (proof of concept, 2026-11-19): `POST /api/teams`, `POST /api/websites` with a `teamId` (the team's own websites route only lists), `POST /api/users` with the role `view-only`, and `POST /api/teams/{id}/users` with the role `team-view-only`. Umami's first-boot administrator has a published default password, which the installation must replace.
4. In `open` mode the tenant is active immediately. In `approval` mode it waits in an operator queue. The mode is an operator setting, changeable at any time.
5. Operators can suspend or remove a tenant. Suspension stops ingestion (tokens and site IDs rejected at the gateway) and access; removal additionally deletes the tenant's data.

**Why view-only.** In Umami v3.5.0 the roles `view-only` and `team-view-only` carry no permission, and editing, resetting or deleting a website each require one (checked in `ROLE_PERMISSIONS` and the website permission checks). A tenant can therefore read its numbers but cannot change or erase them, which is what makes them usable by SCF.

**Single sign-on to Umami.** Tenants never receive an Umami password. When a tenant opens its web dashboard, the console signs in to Umami server-side as that user and redirects the browser to Umami's built-in `/sso` page with the resulting token (page present in v3.5.0). Umami binds a token to the user's password hash, so the console rotates that user's password at console sign-out and at least daily, which invalidates earlier tokens. Checked on Umami v3.5.0 (proof of concept, 2026-11-19): the page is `/sso?token=…&url=…`, where `url` must be a path inside Umami; the token has no expiry of its own, and a password change does invalidate it, so the rotation is what bounds its life.

**What of Umami is reachable from the internet.** Because tenants use Umami's dashboard, Umami is published through a path allow-list at the reverse proxy: dashboard pages, the `/sso` page and the API routes the dashboard reads. Umami's own collection endpoint, its stock tracker script and its password login are not routed from the internet. Collection reaches Umami only from the gateway, and sign-in only from the console, both over the private network. A direct post to Umami therefore cannot bypass IP truncation or the bot checks. Checked in the proof of concept (2026-11-19, `infra/compose/proxy/Caddyfile`): the dashboard of a view-only user calls 14 read routes (`GET /api/websites/{id}` and its sub-routes, `/api/realtime/{id}`, `/api/users/{id}/websites`, `/api/2fa/status`) and one token check (`POST /api/auth/verify`); publishing those, the pages and the static files is enough for the overview, events, sessions, realtime and compare pages. It must be a strict allow-list: a view-only user can create an API key through `/api/me/api-keys`, and that key keeps working after a password rotation; and Umami's `DISABLE_LOGIN` blocks the sign-in page only, not `/api/auth/login`. Neither route is published.

### 5.6 Console (`apps/console`)

One Next.js application, three audiences:

- **Tenant:** properties, domain verification, tracker snippet, link to the web dashboard in Umami (W9), API services and ingest tokens, API dashboard (A8), deletion requests.
- **Operator:** global web and API comparison with filtering, sorting and side-by-side view (W10, A9); quarantine ratios; enrollment mode and queue; tenant suspension and removal; API keys; audit log. Operators open any property's Umami dashboard through the same single sign-on, as a view-only member of every team. Operator accounts require two-factor authentication.
- **Public:** documentation, status link, service terms.

Sign-in uses an established open-source authentication library (email link and GitHub sign-in).

### 5.7 Metrics API

- Read-only, versioned (`/v1`), described by an OpenAPI document. Served by the console application.
- Keys are created and revoked by operators, stored hashed, shown once, scoped (`global` or a list of tenants), rate-limited, with optional expiry.
- Serves the rollup tables only.

### 5.8 Scheduled jobs

Daily API rollup; daily web rollup read from Umami's API; retention deletes; served-script integrity check. They run from the gateway image on a schedule and are idempotent, so a missed run is repeated safely.

### 5.9 Monorepo layout

```text
apps/        console/  gateway/  landing/ (current landing page)  docs/ (VitePress documentation site)
apps/docs/   architecture/  operators/ (runbooks)  tenants/ (onboarding)  security/  privacy/
packages/    tracker/  normalizer/  config/
infra/       tofu/ (modules, environments)  compose/ (local full stack)  collector/ (configuration)  monitoring/
examples/    static-html/  react-spa/  nextjs-ssr/  otel-node/  otel-collector-dual-export/
tests/       e2e/  isolation/  abuse-corpus/  load/
```

The monorepo uses pnpm workspaces and Turborepo. Umami and the Collector are consumed as container images pinned by digest, not vendored.

## 6. Stellar integration and data flows

Calistar does not use the ledger. It is infrastructure for projects that do. The Stellar-specific work is:

### 6.1 Path normalization for Stellar identifiers (A4)

Rules are applied per path segment, in this order, after stripping the query string and trailing slash:

| # | Pattern | Replacement |
|---|---|---|
| 1 | Stellar secret seed (`S…`, 56 chars) | `:redacted` — never stored |
| 2 | Muxed account (`M…`, 69 chars) | `:muxed` |
| 3 | Account (`G…`, 56 chars) | `:account` |
| 4 | Contract (`C…`, 56 chars) | `:contract` |
| 5 | Other Stellar keys (liquidity pool, claimable balance, pre-auth, hash-x, signed payload, muxed contract) | `:strkey` |
| 6 | Asset in `CODE-ISSUER` or `CODE:ISSUER` form | `:asset` |
| 7 | UUID | `:uuid` |
| 8 | 64-character hex (transaction hash, SHA-256) | `:hash` |
| 9 | Other long hex, `0x`-prefixed values | `:hex` |
| 10 | Integer (IDs, ledger sequences) | `:id` |
| 11 | Long opaque tokens (JWT-like, base64url) | `:token` |
| 12 | Any remaining segment over 64 characters | `:long` |

- The rules are hard-coded in `packages/normalizer` (TypeScript) and run in the gateway's metrics writer.
- Stellar keys are matched by shape, without checksum, on the fully percent-decoded and upper-cased segment: a mistyped, lower-cased or encoded key is replaced too. A secret seed is searched anywhere in a segment, and any base32 run long enough to hold a key is replaced (`:strkey`), which also covers a key glued to other text and a key type that does not exist yet. A segment still encoded after 16 decoding rounds is redacted (proof of concept, 2026-11-19).
- A tenant-set `http.route` is respected and still passed through the rules, so a raw address can never be stored as a route.
- The test corpus is generated with the current stable Stellar SDK's key utilities, so every valid key type is covered.

### 6.2 Stellar Wallets Kit event capture (W6)

Deferred with custom events (§2.3). The tracker payload is versioned so that an adapter recording wallet-flow events — wallet type only, never an address, transaction or signature — can be added in a later tracker version.

### 6.3 Ecosystem enrollment signals (G3)

At enrollment, the console checks for signals that a property belongs to the ecosystem: the linked SCF project record and, where present, a `stellar.toml` (SEP-1) on the verified domain, resolved with the Stellar SDK. Signals are shown to operators to support removal decisions; they do not block enrollment in `open` mode.

### 6.4 Data flows

- **Web event:** browser → gateway (truncate, minimize, check) → Umami → `umami` database → daily rollup → operator view and API. Tenants read Umami's dashboard directly.
- **API metric:** tenant service → gateway (authenticate) → Collector (drop, filter, convert) → gateway (normalize, aggregate) → `api_metric_1h` → daily rollup → dashboards and API.
- **Operator comparison:** console or API → rollup tables only.

### 6.5 What is deliberately not claimed

No smart contracts, no on-chain writes, no mainnet deployment in the ledger sense. The final tranche's "mainnet or equivalent" is the production deployment with live SCF projects. The tranche-2 monitoring plan follows SDF's template structure with on-chain sections marked not applicable.

## 7. Security, privacy and threat model

### 7.1 Privacy design (T4, W8)

| Data | Handling |
|---|---|
| IP address | Truncated in memory at the gateway; used transiently for country and the visitor hash; never stored or logged |
| User agent | Reduced to browser, OS, device class; raw string not stored |
| Visitor identity | Hash of site, truncated IP, user agent, and a daily salt that is destroyed and never backed up (§5.2). No cross-site identifier; the hash differs per site and per day |
| Device storage | None. No cookies, `localStorage` or `sessionStorage` |
| Location | Country only. This needs a country-level database in place of the city-level one Umami ships (§5.2) |
| Traces, spans, logs | Dropped in memory; never written |
| API metrics | Aggregates only; no request-level rows, no client IPs, no headers, no bodies |
| Access logs | Ingest-tier logs exclude IP addresses and paths; short retention |

Consequence for unique visitors: counts are unique per day. Longer-range "unique visitors" are sums of daily uniques, labelled as such. The RFP accepts privacy-driven limits here.

### 7.2 Compliance statements (D4) — draft, pending legal review

- **Roles.** Each tenant is controller for its visitors' data; the service operator is processor; SCF operators receive aggregated statistics. Enrollment terms and a data-processing agreement template are part of the documentation deliverable.
- **Data residency.** All processing and storage in the EU, in one AWS region of the EU; backups in a second EU location. No transfers outside the EU.
- **Right to erasure.** No stored data can be linked to an individual by the operator once the daily salt is destroyed, so individual erasure requests cannot be matched to records (GDPR Art. 11). Tenants can still trigger deletion from the console: a whole property (through Umami's own reset API, called by the console with an administrator credential) or the whole tenant. Every deletion is logged and propagates to rollups.
- **Jurisdictions.** The design target is operation without end-user opt-in under GDPR, UK GDPR and the ePrivacy rules as implemented in EU member states, because nothing is stored on or read from device storage and no personal data is retained. Regulators differ on whether script-based collection itself needs consent or an audience-measurement exemption. The compliance document will list, per jurisdiction, where opt-in is considered unnecessary, where an exemption's conditions apply, and where a tenant should take local advice. **This list requires review by counsel and is not final.**

### 7.3 Tenant isolation and access control (G2, A7)

| Layer | Web data | API data |
|---|---|---|
| 1. Console authorization | Every request resolves the session's tenant server-side; single sign-on is issued only for the session's own Umami user | Every request resolves the session's tenant server-side |
| 2. Engine scoping | Umami's own permission checks: the user is a view-only member of its tenant's team and of no other | PostgreSQL row-level security keyed on a per-request tenant setting |
| 3. Database roles | The console has no access to the `umami` database | Tenant-path role cannot bypass row-level security; operator queries use a separate role |

- Ingest credentials are write-only and cannot read anything.
- Umami's password login, including the administrator's, is reachable only from the private network (§5.5).
- Operator access to the global view is logged.
- A dedicated isolation test suite attempts cross-tenant reads through every console and API endpoint, and through Umami's API with a tenant user's token. It runs on every change.

### 7.4 Supply-chain defense (W4)

- **Tracker:** zero runtime dependencies; reproducible build; immutable versioned URLs with SRI; integrity check of served files; documented Content-Security-Policy for tenants.
- **Build pipeline:** CI actions pinned by commit; lockfiles enforced; dependency and vulnerability scanning on every change; protected default branch that accepts changes only through pull requests with passing checks; signed tags.
- **Artifacts:** container images pinned by digest and signed; SBOM and provenance attestation attached to every release.
- **Upstream Umami and Collector:** pinned by digest; upgraded only through a pull request that passes the contract and isolation suites; Umami's outbound calls disabled (`PRIVATE_MODE`, `DISABLE_TELEMETRY`, `DISABLE_UPDATES`).
- **Access:** two-factor authentication for the maintainer and operators; least-privilege deploy credentials; secrets in the provider's secret manager, never in the repository.
- **Single maintainer.** There is no second human reviewer. The controls above are automated for that reason, and release provenance lets anyone verify that a published artifact was built by CI from a public commit.

### 7.5 Threat model summary (STRIDE)

The full threat model is a tranche-2 deliverable. Main threats and controls:

| Threat | Example | Control |
|---|---|---|
| Spoofing | A tenant inflates its own traffic | Gateway layers L0–L3; quarantine ratio visible to operators |
| Spoofing | A third party sends events for someone else's site ID | Origin bound to verified domains; script-execution token |
| Spoofing | Events posted directly to Umami, bypassing the gateway | Umami's collection endpoint is not routed from the internet; refusal is a case in the abuse corpus |
| Spoofing | A service reports metrics as another tenant | Tenant derived from token only |
| Tampering | Modified tracker served to visitors | SRI, immutable URLs, integrity check |
| Tampering | A tenant edits or resets its own web data | View-only Umami roles |
| Tampering | Malicious dependency or CI action | §7.4 |
| Repudiation | Disputed operator action | Audit log |
| Information disclosure | Cross-tenant read | Isolation layers; isolation test suite |
| Information disclosure | Single sign-on token leaked from a URL | Short-lived by password rotation; view-only; own team only |
| Information disclosure | Secrets or personal data in OTLP payloads | Dropped in memory; attribute allow-list; secret-seed redaction rule |
| Denial of service | Ingest flood, route-cardinality explosion | Rate limits per token and site; cardinality cap; memory limiter |
| Elevation of privilege | Tenant gains operator view | Separate role, two-factor, separate database role |
| Elevation of privilege | Leaked metrics API key | Hashed storage, scopes, expiry, revocation, last-use tracking |

## 8. Testing, validation and performance

### 8.1 Test layers

| Layer | Scope |
|---|---|
| Unit | Normalizer rules, percentile math, token handling, gateway checks |
| Integration | Gateway and Collector against real PostgreSQL; gateway against real Umami |
| End-to-end | Playwright: enrollment, single sign-on, API dashboard, operator flows, deletion |
| Isolation | Cross-tenant access attempts on every endpoint |
| Abuse corpus | Scripted clients with expected accept/quarantine results, including a direct post to Umami |
| Compatibility | Example apps (static, SPA, SSR) on Chromium, Firefox and WebKit; OTLP from the Node.js SDK and from a tenant-side Collector |
| Load | See §8.3 |
| Restore | Backup-restore drill before production launch |

All suites run from a single command against the local full stack, so reviewers can reproduce results.

### 8.2 Metric correctness

A fixed synthetic event set with known answers (page views, visitors, bounce rate, duration, p50/p95) is replayed in CI; Umami, dashboard and API results must match.

### 8.3 Performance targets

1,000,000 requests/day is about 12 requests/second on average. Because metrics arrive pre-aggregated, database writes scale with the number of distinct routes, not with request count.

| Test | Target |
|---|---|
| API ingestion equivalent to ≥ 10,000,000 requests/day, sustained for 1 h | No data loss; ingest p99 < 250 ms |
| Web events at 50 events/second for 10 min, with 10× bursts | No data loss; ingest p99 < 250 ms |
| Tenant API dashboard, 30-day range | p95 < 1 s |
| Operator comparison, 100 tenants, 12 months of seeded data | p95 < 2 s |
| PostgreSQL interruption of 5 minutes during API ingestion | No API data loss after recovery (in-memory retry) |

Results, scripts and hardware description are published in the repository. Longer database outages, or a Collector restart during one, lose the API data points in flight; the web path loses events for the duration of a database outage. Both limits are stated in the service description.

### 8.4 Results so far

Measured in the proof of concept, on 2026-11-19, in CI on a hosted runner (4 CPUs, 15 GiB) shared by the load generator and the whole stack:

- 349 unit tests and 44 tests on the running stack pass, among them the tests that search both databases and every log for a marker sent in traces, logs and a visitor's address.
- A 10-minute run on the API path, through the reverse proxy: 120,040 requests represented (200 per second, 17 times the design target), none refused, 120,040 stored, ingest latency p99 5.8 ms.

This is not the one-hour test of §8.3, which belongs to tranche 2. Details are on the [proof of concept](/architecture/proof-of-concept) page.

## 9. Deployment, monitoring and operations

### 9.1 Infrastructure (T3)

- **Shape:** gateway, Collector and Umami with two replicas each, restarted automatically on failed health checks, behind a load balancer and a reverse proxy that publishes Umami through a path allow-list (§5.5); console as a container; managed PostgreSQL with point-in-time recovery; object storage and CDN for tracker files and backups. No instance keeps state on local disk.
- **Provider:** AWS, one EU region. The requirement that drives the choice is handover: only commodity building blocks (containers, load balancer, managed PostgreSQL, object storage), all declared in OpenTofu, so a future operator can rebuild on the same or another provider.
- **Environments:** local (`compose`) and one cloud environment, which becomes production. The same modules create a second environment on demand, for example for the rebuild rehearsal.

### 9.2 Monitoring baseline (D2)

- Probe configuration, dashboards and alert rules live in `infra/monitoring`.
- External synthetic probes send a real web event and a real OTLP export and read them back; availability figures are computed from these probes.
- Public status page with incident history.
- Alerts: ingestion failure, export retry growth, backup failure, certificate expiry, integrity-check mismatch, quarantine spikes.

### 9.3 Service levels (H2)

The service is run by one maintainer without on-call, which the RFP allows. Commitments are set to what that model supports; measured values are published monthly.

| Target | RFP expectation | Commitment | Basis |
|---|---|---|---|
| Ingestion availability | 99.99 % | 99.9 % committed, 99.99 % objective | Two replicas with automatic restart; each ingest token is pinned to one Collector replica and moved on failure. The gateway caches token-to-tenant and site-to-domain mappings in memory, so the API path keeps accepting data when the database is briefly unreachable. The web path writes through Umami synchronously and loses events during a database failover. An incident that does not recover automatically outside working hours can last hours, which is why 99.99 % is an objective and not a promise |
| Dashboard availability | 99.90 % | 99.5 % committed, 99.9 % objective | Managed PostgreSQL; single console instance with automatic restart |
| Critical/high vulnerabilities | Patched within 24 h | 24 h on business days; 72 h during announced absences | Automated scanning, automated update pull requests, one-command deployment, documented patch runbook |
| Support | Response 5, resolution 10 business days | Response 5, resolution 10 business days | Public issue tracker with labels and tracked timers |

- **Continuity.** A backup contact with emergency deploy access is named before production launch. Handover readiness (§9.5) is reached before the final tranche, so SCF can appoint another operator at any point in the service window.
- If measured ingestion availability holds at 99.99 % over the first three months, the commitment is raised.

### 9.4 Backups and recovery

Point-in-time recovery; daily logical backups to a second location; one restore drill before production launch and one before handover. Recovery objectives: RPO 15 minutes, RTO 4 hours.

### 9.5 Handover (H4)

- **Handover kit:** operator runbooks, architecture notes, credential inventory, cost sheet, on-call-free support process.
- **Rebuild rehearsal:** before the final tranche, the maintainer builds a working environment in an empty cloud project from the monorepo, following the documentation only, and publishes the recording and the gaps fixed. An SCF-designated person is invited to run the same procedure.
- **Data migration:** documented dump and restore of both databases, with verification queries.
- **Domain:** the service runs on a dedicated neutral domain so it can be transferred as a whole; pinned tracker URLs and hashes keep working after transfer.
- **Repository:** hosted from day one in an organization that can be transferred or to which the new operator can be added as owner.

## 10. Licensing, maintenance and roadmap

### 10.1 License

One OSI-approved license for all Calistar code and infrastructure: Apache-2.0, chosen for its patent grant (decided 2026-11-19; `LICENSE` at the repository root). Third-party licenses are scanned in CI; Umami remains MIT.

### 10.2 Building in the open (T5)

Public repository from the first tranche; public issue tracker and roadmap; changelog and semantic versioning; a short progress update to the community at least monthly and at each tranche.

### 10.3 Maintenance

- Dependency updates automated and checked weekly; Umami and Collector upgrades evaluated at each upstream release.
- Tracker versions are supported indefinitely at the ingest contract level.
- Security policy with private reporting channel.

### 10.4 Decentralization (T2)

The service is centralized by design: the RFP asks for one shared service with a privileged operator view. What limits the resulting dependence on any single party: all code and infrastructure are open source; any project or organization can run its own instance; and stewardship moves to a community operator within twelve months.

### 10.5 Roadmap after delivery

Months 1–12 after the final tranche: operate, support, publish service levels, hand over between months 6 and 12 at SCF's discretion. Candidate improvements, outside this proposal's scope, are the deferred items in §2.3, in this order: custom events and Stellar Wallets Kit capture, metrics derived from spans, OTLP over gRPC, statistical anomaly flags, erasure by time range.

## 11. Open risks

Points the design relies on that are not established yet. Each has an owner in the delivery plan.

| Risk | Why it is open | When it is settled |
|---|---|---|
| Country-level location | Umami's stock image stores region and city. Supplying a country-level database through `GEOLITE_DB_PATH` is not tested (§5.2, §7.1) | Tranche 1, with the web path |
| Collector failover | No double counting was shown on one Collector. Moving a stream between two replicas is not tested (§5.3) | Tranche 2, with the performance validation |
| Compliance statements | The position on consent, per jurisdiction, has not been reviewed by counsel (§7.2) | Before production launch |
| Upstream changes in Umami | Provisioning, single sign-on and the published route list were checked on v3.5.0 only (§5.5) | At each upgrade: the stack tests run against the new release first |
| One maintainer | No second reviewer, no on-call (§7.4, §9.3) | Mitigated, not removed: automated controls, a backup contact, handover readiness before the final tranche |
| GoatCounter comparison | Two statements about GoatCounter come from its README and documentation only (§3.3) | Does not affect the design: the choice of Umami rests on the other criteria too |
