---
title: For builders
description: What a Stellar project gets from Calistar, what it adds to its site and its API, and what is stored.
---

# For builders

::: warning Draft
Enrollment is not open. Calistar is a proposal, and this page describes how integration is designed to work. The snippet, the endpoints and the step-by-step guides will be published here with the first release.
:::

A project that enrolls is a **tenant**. It registers its web properties and its API services, and it sees its own data only.

## What you get

- **A web dashboard** with page views, unique visitors, referrers, session duration, bounce rate, country, and device and browser.
- **An API dashboard** with request volume, status-code distribution, and p50 and p95 latency, over a time range you select.
- **Numbers SCF can rely on.** Operators see the same standardized metrics for every enrolled project, measured the same way.
- **No fees.** There is no billing, no paid tier and no usage limit tied to payment.

## Web analytics

1. Sign in to the console and create your project.
2. Prove that you control each domain, with a DNS TXT record or a file under `/.well-known/`.
3. Add one `<script>` tag to your site. It works for static HTML, single-page apps and server-rendered sites.
4. Open your dashboard.

The script is pinned to a version. Its URL never changes content and the tag carries an integrity hash, so a browser refuses a modified file. An upgrade is a new URL and a new hash that you choose to install. There is no `latest` URL.

## API analytics

1. Create an ingest token in the console.
2. Add a second OTLP-over-HTTP metrics exporter, either in your OpenTelemetry SDK or in your own Collector. Your existing export to your own backend stays as it is.
3. Export HTTP server metrics (`http.server.request.duration`).

Traces and logs are accepted and dropped: nothing from them is stored. The recommended setup is to send metrics only, with delta temporality.

Routes are normalized before storage. Stellar accounts, contracts, muxed accounts, transaction hashes, UUIDs and numeric IDs in a path are replaced by placeholders such as `:account` or `:id`, and a secret seed is redacted and never stored.

## What is stored

| | Stored | Never stored |
| --- | --- | --- |
| Web | Hostname, URL path, referrer, country, browser, operating system, device class | IP addresses, cookies, device storage, cross-site identifiers, page titles, custom event data |
| API | Per route and hour: request count, status code, latency histogram | Traces, spans, logs, request bodies, headers, client IP addresses, raw paths |

More detail is on the [Privacy](/privacy/) page.

## Things to know

- **Unique visitors are counted per day.** A longer range shows the sum of daily counts, and is labelled as such. This is the price of not keeping an identifier.
- **Events must reach Calistar directly from the browser.** Proxying them through your own server is not supported, because it would let a project alter its own numbers.
- **Your web dashboard is read-only.** You can read your numbers but not edit or reset them. You can still ask for a property, or your whole project, to be deleted.

## Planned guides

- Web: static HTML, React single-page app, Next.js with server rendering.
- API: the Node.js OpenTelemetry SDK, and dual export from your own Collector.

Each guide will come with a runnable example in the repository.
