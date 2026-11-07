# insurance-quality-engineering

[![CI](https://github.com/Naysrania18/insurance-quality-engineering/actions/workflows/ci.yml/badge.svg)](https://github.com/Naysrania18/insurance-quality-engineering/actions/workflows/ci.yml)

A quality-engineering portfolio project for a **Senior QA / Quality Engineer** role in commercial insurance.
It contains a small, realistic **demo** insurance platform and a complete, layered test and quality approach
around it: risk-based planning, unit, API, contract, SQL, event-driven, UI/E2E, migration, security,
performance, resilience and AI-assisted testing, running in CI with quality gates.

> **Important:** the platform here is a **demo system built for testing practice, not a real product.**
> **All data is fake** (generated with `faker`, fixed seed). No real companies, people, policies or claims are
> used anywhere. Four defects are **planted on purpose** so the tests have real issues to find
> ([docs/planted-defects.md](docs/planted-defects.md)).

**Where to start:** [docs/jd-skills-map.md](docs/jd-skills-map.md) maps each skill to the exact file that demonstrates it.

## The demo domain

A broker submits a risk (marine cargo or commercial property) -> an underwriter quotes -> the policy is bound with
the premium **shared across several insurers (co-insurance)** -> a claim is notified -> assessed -> settled.

```mermaid
flowchart LR
  subgraph UI
    W[Web UI<br/>broker - underwriter - claims]
  end
  subgraph Services
    Q[quote-service<br/>:3001]
    P[policy-service<br/>:3002]
    C[claims-service<br/>:3003]
  end
  DB[(PostgreSQL<br/>brokers risks quotes policies<br/>insurer_shares premiums claims<br/>audit_log outbox)]
  MQ{{RabbitMQ<br/>PolicyBound - ClaimNotified - ClaimSettled}}
  W --> Q & P & C
  Q --> DB
  P --> DB
  C --> DB
  C -- "GET /policies/:id (Pact contract)" --> P
  P -- outbox --> MQ
  C -- outbox --> MQ
  MQ -- ClaimNotified / ClaimSettled --> P
  T[Toxiproxy<br/>fault injection] -.-> C
```

Key design points (all visible in the code and discussed in [docs/testability-review.md](docs/testability-review.md)):
money is integer cents; events use a **transactional outbox** (no lost events); consumers are **idempotent** and
**order-independent**; every state change writes to `audit_log`.

## Quick start

Prerequisites: Node 22+, and Docker with Compose for the full stack. (Without Docker you can still run most things, see below.)

```bash
npm ci
docker compose up --build -d      # Postgres, RabbitMQ, quote/policy/claims services, web UI
bash scripts/wait-for-stack.sh    # wait until healthy
npm run seed                      # fake data (needs DATABASE_URL=postgres://demo:demo@localhost:5432/insurance)
# UI: http://localhost:3000   APIs: :3001 :3002 :3003   RabbitMQ UI: http://localhost:15672 (guest/guest)
```

**No Docker?** `npm run dev` runs the whole platform in one process using an in-process PostgreSQL (PGlite) and an
in-memory event bus on the same ports. Most test suites below work this way too.

## Running each type of test

| Test type | Command | Notes |
| --- | --- | --- |
| Unit + coverage gate | `npx vitest run --coverage` | premium and co-insurance maths; thresholds 90/85/90 |
| API (Playwright) | `npm run test:api` | starts the in-process stack automatically; `BASE_URL` to target compose |
| Postman / Newman | `npm run test:newman` | HTML report in `reports/newman-report.html` |
| Contract (Pact) | `npm run test:contract` | consumer + provider verification |
| UI / E2E | `npx playwright install chromium` then `npm run test:e2e` | HTML report in `reports/playwright-html` |
| Smoke only | `npm run test:smoke` | tag `@smoke` |
| SQL data validation | `npm run test:sql` | in-process by default; `STACK_MODE=external DATABASE_URL=...` for compose |
| Event-driven | `npm run test:events` | add `RABBITMQ_URL=amqp://guest:guest@localhost:5672` for real RabbitMQ |
| Data migration | `npm run test:migration` and `npm run report:migration` | report in `reports/migration-report.md` |
| Security (ZAP) | `bash security/run-zap.sh` | Docker; **localhost only**; fails on High alerts |
| Performance (k6) | `k6 run performance/load.js` (also `stress.js`, `spike.js`) | `SCALE=0.25` for a short run |
| Resilience (Toxiproxy) | see `ci.yml` job `resilience` | needs the compose `resilience` profile |
| AI-assisted | `npm run test:ai` (mocked), `npm run ai:generate -- --story "..."` | needs `ANTHROPIC_API_KEY`; `--mock` works offline |
| Lint / format / types | `npm run lint`, `npm run format:check`, `npm run typecheck` | |
| Quality summary | `npm run report:quality` | `reports/quality-summary.md` |

Tests for known defects assert the **correct** behaviour and are marked as expected failures
(`it.fails` / `test.fail`) with a link to the defect report, so the pipeline stays green while the defects are visible.

## What is in the repository

| Path | Contents |
| --- | --- |
| `services/` | quote, policy, claims services (Express + TypeScript) and their OpenAPI specs |
| `shared/` | pricing, co-insurance allocation, DB and event-bus abstractions, outbox |
| `web/` | broker / underwriter / claims UI |
| `db/` | schema, fake-data seed, v1 -> v2 migration |
| `tests/` | unit, api, e2e, contract, sql, events, migration, resilience, postman |
| `security/`, `performance/` | ZAP runner and rules, k6 scripts |
| `ai-testing/` | AI test-idea generator and defect triage suggester (tests use a mocked LLM) |
| `docs/` | strategy, risk plan, acceptance criteria, release report, defects, RCA, testability, mentoring |
| `.github/workflows/ci.yml`, `azure-pipelines.yml` | the same multi-stage pipeline for GitHub and Azure DevOps |

## CI and quality gates

Stages: build -> unit -> API/contract -> E2E -> security -> performance (+ resilience), with JUnit XML results.

| Gate | Rule |
| --- | --- |
| Coverage | calculation core >= 90% lines / 85% branches / 90% functions |
| Smoke | zero failed `@smoke` tests |
| Performance | k6 thresholds (error rate, p95/p99) |
| Security | no High-risk ZAP alerts |
| Data | migration reconciliation PASS |

A generated summary is attached to every run (see the "Quality summary" job).

## Sample reports

Snippet from a real CI run ([docs/release-readiness-report.md](docs/release-readiness-report.md) has the full picture):

```
| Unit (Vitest)                    | PASS | 35 | 0 | 0 |
| API + E2E (Playwright)           | PASS | 46 | 0 | 0 |
Coverage: lines 100%, branches 100%, functions 100%
k6:   load p95 7 ms | stress p95 64 ms | spike p95 126 ms | 0% errors
ZAP:  0 High, 0 Medium, 4 Low, 6 Informational (all triaged in docs/security-triage.md)
Migration: 201 legacy rows -> 198 migrated + 3 quarantined, 0 field differences
```

Other reports: `reports/playwright-html/` (traces, screenshots), `reports/newman-report.html`,
`reports/migration-report.md`, `reports/zap/*.html`.

## Real bugs the tests found (beyond the planted ones)

- **Resilience tests** found that the Postgres pool crashed the whole service when a connection was dropped (missing `error` handler). Fixed.
- **ZAP** found `GET /risks?status=%00` returned HTTP 500. Fixed with input validation, with a regression test.

## What I learned

> TODO: write this section in your own words (for example: what surprised you about rounding and
> co-insurance, how outbox and idempotency changed the way you test events, which test level caught which
> defect, what you would do differently). Keep it honest and specific.

## References and credits

All code in this repository is original. Design ideas came from these well-known projects and documentation:

- Playwright documentation: Page Object Model, fixtures, tags and trace viewer ([playwright.dev](https://playwright.dev))
- Pact: consumer-driven contract testing ([docs.pact.io](https://docs.pact.io))
- OWASP ZAP: API scan and baseline scan modes ([zaproxy.org](https://www.zaproxy.org))
- k6: thresholds and scenarios ([k6.io](https://k6.io))
- Toxiproxy by Shopify: network fault injection ([github.com/Shopify/toxiproxy](https://github.com/Shopify/toxiproxy))
- Chris Richardson, *Microservices Patterns*: transactional outbox and idempotent consumer
- Martin Fowler: Test Pyramid
- Newman and the Postman collection format ([learning.postman.com](https://learning.postman.com))
- PGlite by ElectricSQL (in-process PostgreSQL) used for fast local runs

## Limitations
No authentication, short CI performance runs, Chromium only, shared database between services. See
[docs/testability-review.md](docs/testability-review.md) and [KNOWN-ISSUES.md](KNOWN-ISSUES.md).

## License
MIT. See [LICENSE](LICENSE).
