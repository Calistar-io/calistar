---
title: Privacy
description: What Calistar is designed to store and never store, and its draft position on data residency, erasure and consent.
---

# Privacy

::: warning Draft, pending legal review
Calistar is a proposal. This page describes the privacy design and a draft compliance position. The compliance statements have not been reviewed by counsel and are not final.
:::

Calistar measures services, not people. Personal data is removed in memory at ingestion, before anything is written.

## What happens to each kind of data

| Data | Handling |
| --- | --- |
| IP address | Truncated in memory at the gateway. Used briefly to derive the country and the visitor hash. Never stored or logged. |
| User agent | Reduced to browser, operating system and device class. The raw string is not stored. |
| Visitor identity | A hash of the site, the truncated IP address, the user agent and a daily salt. The salt is destroyed every day and never backed up. The hash differs per site and per day, so there is no cross-site identifier. |
| Device storage | None. No cookies, no `localStorage`, no `sessionStorage`. |
| Location | Country only. |
| Traces, spans, logs | Dropped in memory. Never written. |
| API metrics | Aggregates only. No request-level rows, no client IP addresses, no headers, no bodies. |
| Access logs | Ingest-tier logs exclude IP addresses and paths, and are kept for a short time. |

Once the daily salt is destroyed, a visitor hash can no longer be recomputed from an IP address and a user agent, including by the operator.

## What this costs

Unique visitors are unique **per day**. A count over a longer range is a sum of daily counts, and is labelled as such.

## Draft compliance position

### Roles

Each project is the controller for its visitors' data. The service operator is the processor. SCF operators receive aggregated statistics.

### Data residency

The design keeps storage and application processing in the European Union. The hosting provider and the region are not chosen yet.

### Right to erasure

Once the daily salt is destroyed, the operator cannot link stored data to an individual, so an individual erasure request cannot be matched to records. A project can still delete a whole property, or its whole tenant, from the console. Every deletion is logged and also removes the data from the rollups.

### Consent

The design target is operation without an end-user opt-in under GDPR, UK GDPR and the ePrivacy rules as implemented in EU member states: nothing is stored on or read from the visitor's device, and no personal data is retained.

Regulators differ on whether script-based collection itself needs consent, or falls under an audience-measurement exemption. The final compliance document will state, for each jurisdiction, where an opt-in is considered unnecessary, where an exemption's conditions apply, and where a project should take local advice.
