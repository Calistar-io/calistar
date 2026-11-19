# Short load run: results

Run of `tests/load/api-ingest.js`, followed by `tests/load/verify-counts.mjs`.

Commit identifiers below are those of the current history. The run pages show an earlier identifier of the same commits: the same files, before the commit messages were edited.

## 2026-11-19, GitHub-hosted runner

[Workflow run 44505024006](https://github.com/Calistar-io/calistar/actions/runs/44505024006), job "Short load run", commit `a0f7176`. The summary file is attached to the run as the artifact `load-run`.

Requests went through the reverse proxy, as they would from outside: proxy, gateway, Collector, gateway, PostgreSQL.

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
| Ingest latency, median | 2.7 ms |
| Ingest latency, 95th percentile | 4.3 ms |
| Ingest latency, 99th percentile | 5.8 ms |
| Ingest latency, maximum | 35.1 ms |

Latency is what the exporter sees: the time for the proxy and the gateway to authenticate the request, pass it to the Collector and return the Collector's answer.

**Hardware.** A GitHub-hosted `ubuntu-latest` runner: 4 CPUs, 15 GiB of memory, Linux 7.0.0-1020-azure. The load generator and the whole stack shared that machine: PostgreSQL, Umami, the Collector, the gateway, the reverse proxy and the two examples. The run's summary page lists the usage of each container.

**What this run is not.** It is ten minutes, not the one-hour test planned for the service; it is one machine; and it covers the API path only.

## Earlier runs

- [Run 44501975603](https://github.com/Calistar-io/calistar/actions/runs/44501975603), commit `efee494`, before the reverse proxy existed: requests went straight to the gateway. Same workload, 120,040 requests stored for 120,040 sent, latency median 2.2 ms, 99th percentile 4.9 ms.
- [Run 44499702922](https://github.com/Calistar-io/calistar/actions/runs/44499702922): the load passed and the count check failed, because of a mistake in the script, which drew a different run identifier for every virtual user. Fixed in `efee494`.
- A local attempt, on a 1.9 GiB virtual machine shared with other containers, ran out of memory before producing a result.
