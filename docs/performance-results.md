# Performance test results and analysis

Tool: k6. Scripts: `performance/load.js`, `performance/stress.js`, `performance/spike.js`. Targets the quote
and claims APIs (risk submission, quoting, claim notification and assessment) through docker compose on a
shared GitHub-hosted runner. The CI run uses `SCALE=0.25`, a shortened profile, so it is a regression
check rather than a capacity test. Run the full profiles locally with `k6 run performance/load.js`.

## Profiles
| Script | Shape | Peak VUs (CI short run) | Purpose |
| --- | --- | ---: | --- |
| load | ramp to 10 quote VUs + 5 claim VUs, hold | 15 | Expected steady traffic |
| stress | ramp 10 -> 30 -> 60 -> 100 VUs | 100 | Find where it bends |
| spike | 5 -> 80 VUs in a few seconds, hold, drop | 80 | Sudden batch of submissions |

## Thresholds (these fail the pipeline)
| Script | Error rate | Latency | Checks |
| --- | --- | --- | --- |
| load | `http_req_failed < 1%` | p95 < 500 ms, p99 < 1000 ms; quotes p95 < 500 ms; claims p95 < 600 ms | > 99% |
| stress | < 5% | p95 < 2000 ms | > 95% |
| spike | < 5% | p95 < 2500 ms | > 95% |

## Results (CI run, 2026-11-07)
| Script | Requests | Throughput | Median | p90 | p95 | Max | Errors | Thresholds |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| load | 1,154 | 49 req/s | 2.3 ms | 5.7 ms | **7.4 ms** | 58 ms | 0% | pass |
| stress | 12,018 | 352 req/s | 10.3 ms | 45.2 ms | **63.8 ms** | 300 ms | 0% | pass |
| spike | 5,338 | 332 req/s | 41.3 ms | 105 ms | **126 ms** | 244 ms | 0% | pass |

## Analysis
- **Headroom is large.** p95 under normal load is 7 ms against a 500 ms budget, so the thresholds are loose by
  design for a shared CI runner. Tighten them (for example p95 < 100 ms) once a baseline is trusted, or they
  will not catch a 10x regression.
- **Latency grows smoothly with load.** From 15 VUs to 100 VUs p95 rises from 7 ms to 64 ms with no errors and
  no knee in the curve: the service is not near saturation at 350 req/s on a small shared runner.
- **The spike costs latency, not correctness.** p95 reaches 126 ms under an 80 VU jump and no request fails.
  The cause was not investigated; a likely contributor is the connection pool
  (`max: 10` in the Postgres client) being saturated at the start of the jump.
- **Shared database, shared contention.** All three services use one PostgreSQL instance. Quote creation takes a
  row lock (`FOR UPDATE`) per risk, which serialises only same-risk requests, so no lock contention shows up here.
- **What would change the picture:** a larger dataset (the seed has 12 policies), network latency to a managed
  database, auth overhead, and the event consumers falling behind (queue depth is not measured by k6; see the
  recommendation below).

## Caveats
- A 15-30 second run per scenario is too short to see memory growth or GC effects. A soak test (30-60 minutes at
  load) is the recommended next script.
- k6 and the system under test share one small runner, so absolute numbers are indicative only. Compare runs
  with each other, not with production.
- Claim creation in k6 uses random loss dates and amounts to avoid the duplicate claim rule (DEF-002 means a
  duplicate would be accepted anyway).

## Recommendations
1. Add a consumer-lag metric (events published vs processed) so performance runs can assert that eventual
   consistency keeps up under load.
2. Add a soak test and a database-size scenario (10^5 policies).
3. Store k6 summaries as artifacts per build and trend p95 across runs, failing on a relative regression.
