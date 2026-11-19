---
title: Security
description: How Calistar is designed to isolate tenants, resist inflated numbers and defend its supply chain.
---

# Security

::: warning Draft
Calistar is a proposal. This page describes the security design, not a running system. The full threat model is a later deliverable.
:::

## Tenant isolation

Isolation is enforced in three layers, so that a bug in one of them does not expose another project's data.

| Layer | Web data | API data |
| --- | --- | --- |
| Console authorization | Every request resolves the session's tenant on the server. Single sign-on is issued only for the session's own Umami user. | Every request resolves the session's tenant on the server. |
| Engine scoping | Umami's own permission checks: the user is a view-only member of its project's team, and of no other. | PostgreSQL row-level security, keyed on a per-request tenant setting. |
| Database roles | The console has no access to Umami's database. | The tenant-path role cannot bypass row-level security. Operator queries use a separate role. |

- Ingest credentials are write-only. They cannot read anything.
- The tenant of an API metric comes from the ingest token alone. A tenant named in the payload is overwritten.
- Umami's password login is not reachable from the internet.
- Operator access to the global view is logged.
- A dedicated test suite attempts cross-tenant reads through every endpoint. It is designed to run on every change.

## Protection against inflated numbers

Web events must come from a real page in a real browser. The gateway applies four layers.

| Layer | What it does | What it does not do |
| --- | --- | --- |
| User agent | Umami's own bot check on the user agent. | Catch a bot that lies about its user agent. |
| Provenance | Requires an origin matching a verified domain of the site, and checks that browser headers are consistent with the user agent. | Stop a client that forges headers. |
| Script execution | The tracker obtains a short-lived signed token and returns it with a value computed in the page. | Stop a headless browser. It separates "a JavaScript engine ran the tracker" from "a server posted JSON". |
| Fingerprint diversity | Many distinct fingerprints from one address in a short window are held back above a threshold. | Penalize ordinary shared networks below the threshold. |

Events that fail a check are quarantined: counted by property, day and reason, and kept out of the project's numbers. Operators see each property's quarantine ratio.

No layer is claimed to be unbeatable. The goal is to make inflation expensive and visible.

## Supply chain

- **Tracker:** no runtime dependency, a reproducible build, immutable versioned URLs with integrity hashes, and a check that the served file matches the published hash.
- **Build pipeline:** CI actions pinned by commit, enforced lockfiles, dependency and vulnerability scanning on every change, and a protected default branch.
- **Artifacts:** container images pinned by digest and signed, with a software bill of materials and a provenance attestation attached to every release.
- **Umami and the Collector:** pinned by digest, and upgraded only through a pull request that passes the test suites. Umami's outbound calls are disabled.
- **Access:** two-factor authentication for the maintainer and the operators, least-privilege deploy credentials, and secrets kept in the provider's secret manager.

The service has a single maintainer, so there is no second human reviewer. The controls above are automated for that reason, and release provenance lets anyone verify that a published artifact was built by CI from a public commit.

## Main threats and controls

| Threat | Example | Control |
| --- | --- | --- |
| Spoofing | A project inflates its own traffic. | The four gateway layers, and a quarantine ratio visible to operators. |
| Spoofing | A third party sends events for someone else's site. | Origin bound to verified domains, and the script-execution token. |
| Spoofing | Events posted directly to Umami, bypassing the gateway. | Umami's collection endpoint is not routed from the internet. |
| Spoofing | A service reports metrics as another tenant. | Tenant derived from the token only. |
| Tampering | A modified tracker served to visitors. | Integrity hashes, immutable URLs, integrity check. |
| Tampering | A project edits or resets its own web data. | View-only Umami roles. |
| Repudiation | A disputed operator action. | Audit log. |
| Information disclosure | A cross-tenant read. | The three isolation layers, and the isolation test suite. |
| Information disclosure | Secrets or personal data in OTLP payloads. | Dropped in memory, attribute allow-list, secret-seed redaction. |
| Denial of service | An ingest flood, or an explosion of distinct routes. | Rate limits per token and per site, a cap on routes per service, a memory limiter. |
| Elevation of privilege | A tenant gains the operator view. | Separate role, two-factor authentication, separate database role. |

## Reporting a vulnerability

The [repository](https://github.com/Calistar-io/calistar) has no security policy yet. One will be added, with a private reporting channel.
