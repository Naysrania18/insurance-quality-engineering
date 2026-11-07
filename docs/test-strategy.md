# Test strategy

Scope: the demo commercial insurance platform (quote, policy and claims services, PostgreSQL, RabbitMQ, web UI).
This is a demo system built for testing practice; all data is fake.

## Principles
1. **Risk first.** Where an error costs money or breaks the audit trail, test deeper. See [risk-based-test-plan.md](risk-based-test-plan.md).
2. **Test at the lowest level that can catch the problem.** Rules are unit tested; contracts are checked between
   services; only a few journeys go through the browser.
3. **Fast feedback, honest gates.** Cheap suites run first and block the expensive ones.
4. **Deterministic tests.** Money is integer cents, data is built by builders, async behaviour is polled with
   timeouts, never `sleep`.
5. **Known defects are visible, not hidden.** They are expected failures linked to a report ([planted-defects.md](planted-defects.md)).

## The test pyramid in this repo

```
            /\          E2E (browser)         6 tests      tests/e2e          few, slow, journey-level
           /  \
          /----\        Resilience (faults)   5 tests      tests/resilience   Toxiproxy, CI only
         /      \       Security / Perf       ZAP, k6      security/, performance/
        /--------\
       /          \     API + Newman          40 + 15 req  tests/api, tests/postman
      /            \    Contract (Pact)       3 tests      tests/contract
     /              \   SQL / events / migration            tests/sql, tests/events, tests/migration
    /----------------\
   /                  \ Unit                  35 tests     tests/unit   pure functions, 100% coverage
  /--------------------\
```

| Level | Goal | Tools | Runs | Gate |
| --- | --- | --- | --- | --- |
| Unit | Premium and co-insurance maths, boundaries, rounding | Vitest | every push, ~1s | coverage 90/85/90 |
| API | Every endpoint: happy path, validation, state machine, concurrency | Playwright `APIRequestContext`, Postman + Newman | every push | all pass |
| Contract | claims-service's expectation of policy-service cannot drift | Pact (consumer + provider verification) | every push | all pass |
| Data (SQL) | Invariants across tables: totals, shares, orphans, audit, duplicates | Vitest + SQL | every push and on compose DB | all pass |
| Events | Publish/consume, idempotency, ordering, consumer down, outbox | Vitest, in-memory bus and RabbitMQ | every push, plus real RabbitMQ in CI | all pass |
| Migration | v1 -> v2 completeness: counts, checksums, field-level | Vitest + report | every push | reconciliation PASS |
| UI / E2E | Broker, underwriter, claims journey | Playwright, Page Object Model | smoke gate + regression | zero failed smoke tests |
| Security | Baseline OWASP checks on every API | ZAP in Docker, localhost only | every push | no high-risk alerts |
| Performance | Latency and error budgets under load, stress, spike | k6 | every push (short) | k6 thresholds |
| Resilience | Behaviour when dependencies are slow or down | Toxiproxy | every push | all pass |
| AI-assisted | Test idea generation and defect triage suggestions | Anthropic API (mocked in CI) | on demand | schema validity |

## Approach per level

**Unit.** Table-driven tests for boundaries (min, max, one cent either side), half-up rounding, panel validation
and the invariant "allocated shares always sum to the total" across thousands of values.

**API.** Each endpoint has a happy path, every validation rule, every illegal state transition, a not-found case
and concurrency checks (five parallel quote requests produce exactly one quote). Security-minded cases are
included (SQL injection in a query string, malformed JSON, security headers, no stack traces).

**Contract.** `claims-service` is the consumer of `GET /policies/:id`. The consumer test generates a pact and the
provider test replays it against the real `policy-service`, with provider states set up in the database.

**SQL.** Each check returns *offending rows*, so an empty result means pass and a failure message lists exactly
which records are wrong. The same queries run against the in-process database and the live compose database.

**Events.** Handlers are tested with duplicates, reversed order, a stopped consumer that recovers, a poison
message, and a broker outage while the outbox holds events. At the service level, eventual consistency is
asserted with polling and an explicit timeout.

**UI.** Few tests, high value: one full journey, a handful of validation checks, tagged `@smoke`, `@regression`
and `@e2e`. Page objects keep selectors in one place; fixtures provide setup; traces, screenshots and video are
kept on failure.

**Non-functional.** ZAP, k6 and Toxiproxy run in CI where Docker is available. Thresholds are defined in code so
they are reviewed like any other change.

## Test data
Builders (`RiskBuilder`, `ClaimBuilder`) produce valid objects with overrides. Seed data uses `faker` with a fixed
seed so it is reproducible. No real names, companies or personal data exist anywhere.

## Environments
| Mode | Database | Bus | When |
| --- | --- | --- | --- |
| In-process | PGlite (WASM Postgres) | in-memory | local, fast CI jobs |
| docker compose | PostgreSQL 16 | RabbitMQ 3.13 | E2E, security, performance, resilience |

The same assertions run against both, which keeps the in-process stack honest.

## Entry and exit criteria
- **Entry to a stage:** the previous stage is green.
- **Exit for release:** see the go/no-go criteria in [release-readiness-report.md](release-readiness-report.md).

## Reporting
JUnit XML from every tool, a Playwright HTML report, a Newman HTML report, a migration reconciliation report, a
ZAP summary and a generated [quality summary](../README.md#sample-reports) per pipeline run.

## Out of scope
Real payment/bordereaux integrations, authentication and authorisation (the demo has none, which is a listed
limitation), accessibility audits, browser matrix beyond Chromium.
