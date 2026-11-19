# Short load run: results

Run of `tests/load/api-ingest.js`, followed by `tests/load/verify-counts.mjs`.

## 2026-11-19, GitHub-hosted runner

[Workflow run 44501975603](https://github.com/Calistar-io/calistar/actions/runs/44501975603), job "Short load run", commit `7039a1a`. The summary file is attached to the run as the artifact `load-run`.

| | |
| --- | --- |
| Duration | 10 minutes |
| Workload | 50 exporters, one OTLP export every 10 seconds each, 40 data points per export |
| Exports sent | 3,001 |
| Exports refused | 0 |
| Iterations dropped by the load generator | 0 |
| Requests represented | 120,040, or 200 per second: 17,280,000 per day, 17 times the RFP design target |
| Distinct routes written | 2,000 |
| **Requests stored** | **120,040: equal to what was sent** |
| Ingest latency, median | 2.2 ms |
| Ingest latency, 95th percentile | 3.4 ms |
| Ingest latency, 99th percentile | 4.9 ms |
| Ingest latency, maximum | 31.9 ms |

Latency is what the exporter sees: the time for the gateway to authenticate the request, pass it to the Collector and return the Collector's answer.

**Hardware.** A GitHub-hosted `ubuntu-latest` runner (image `ubuntu-26.04`), with the load generator and the whole stack on the same machine: PostgreSQL, Umami, the Collector, the gateway, the reverse proxy and the two examples. The run's summary page gives the CPU count, the memory and the per-container usage.

**What this run is not.** It is ten minutes, not the one-hour test planned for the service, it is one machine, and it covers the API path only. A local attempt on a 1.9 GiB virtual machine shared with other containers ran out of memory before producing a result.
