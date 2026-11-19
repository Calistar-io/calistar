---
title: For operators
description: The global view for designated SCF operators, how Calistar is designed to be run, and how it is handed over.
---

# For operators

::: warning Draft
Calistar is a proposal. This page describes the operator plane as designed. Runbooks will be published here as the service is built.
:::

Two kinds of operator are meant here: the people SCF designates to read the global view, and the community operator who takes over the service after the hosting period.

## The global view

Operators compare the same standardized metrics across every enrolled project.

- **Web and API comparison**, with filtering, sorting and a side-by-side view.
- **Quarantine ratio** for each web property: the share of events held back by the bot and inflation checks.
- **Enrollment mode**, switched at any time between `open` (a project is active immediately) and `approval` (it waits in a queue).
- **Suspension and removal.** Suspending a project stops its ingestion and its access. Removing it also deletes its data.
- **API keys** for machine access to the metrics: created and revoked by operators, scoped, and rate-limited.
- **Audit log** of operator and security-relevant actions.

Operator accounts require two-factor authentication. An operator can open any property's web dashboard in Umami, as a view-only user.

## Metrics API

The Metrics API is read-only and versioned, and it comes with an OpenAPI document. It serves the daily rollups only. A key is shown once, stored hashed, and limited to a scope: every project, or a list of projects.

## Running the service

The design keeps to commodity building blocks, so the service can be rebuilt on the same or another provider.

- **Infrastructure as code**, with OpenTofu: containers, a load balancer, managed PostgreSQL with point-in-time recovery, and object storage.
- **A local full stack** started by one command, used for development and for reproducing test results.
- **Monitoring** by external synthetic probes that send a real web event and a real OTLP export and read them back, with alert rules and a public status page.
- **Backups** with a restore drill before production launch and another before handover.

## Handover

The service is designed to be handed to a community operator.

- **Handover kit:** operator runbooks, architecture notes, an inventory of credentials, a cost sheet and the support process.
- **Rebuild rehearsal:** a working environment built in an empty cloud project from the repository, following the documentation only.
- **Data migration:** a documented dump and restore of both databases, with verification queries.
- **Domain:** the service runs on its own dedicated domain, so it can be transferred as a whole. Pinned tracker URLs and hashes keep working after the transfer.

## Runbooks

None yet. They will cover deployment, each alert, tenant removal, upgrades of Umami and the Collector, and restore.
