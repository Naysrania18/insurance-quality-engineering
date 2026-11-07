# Skills map

Each skill a Senior QA / Quality Engineer in commercial insurance is expected to show, mapped to the exact place in this repository that demonstrates it.

| Skill | Where it is demonstrated | What to look at |
| --- | --- | --- |
| Risk-based testing | [`docs/risk-based-test-plan.md`](risk-based-test-plan.md) | 16 scored risks (likelihood x impact), each linked to tests and a status |
| Test pyramid | [`docs/test-strategy.md`](test-strategy.md) | Levels, tools, gates, and why each test sits where it does |
| Playwright + TypeScript | [`tests/e2e/journeys.spec.ts`](../tests/e2e/journeys.spec.ts), [`playwright.config.ts`](../playwright.config.ts) | Full journey, tags `@smoke` `@regression` `@e2e`, retries, traces, screenshots, HTML report |
| Framework maintenance | [`tests/e2e/pages/`](../tests/e2e/pages), [`tests/support/fixtures.ts`](../tests/support/fixtures.ts), [`tests/support/client.ts`](../tests/support/client.ts) | Page Object Model, custom fixtures, test data builders, one place for selectors and URLs |
| Postman / Newman | [`tests/postman/`](../tests/postman), [`scripts/run-newman.ts`](../scripts/run-newman.ts) | Collection + environment, chained variables, polling for eventual consistency, HTML report |
| Contract testing | [`tests/contract/contract.test.ts`](../tests/contract/contract.test.ts) | Pact consumer test (claims-service) and provider verification (policy-service) with provider states |
| SQL validation | [`tests/sql/checks.ts`](../tests/sql/checks.ts), [`tests/sql/validation.test.ts`](../tests/sql/validation.test.ts) | Invariants returning offending rows: shares = premium, 100%, orphans, audit, duplicates |
| Event-driven testing | [`tests/events/events.test.ts`](../tests/events/events.test.ts), [`shared/src/events.ts`](../shared/src/events.ts) | Idempotency, out-of-order, consumer down/recovery, poison messages, eventual consistency with polling |
| Distributed-system failure modes | [`shared/src/outbox.ts`](../shared/src/outbox.ts), [`services/policy-service/src/consumers.ts`](../services/policy-service/src/consumers.ts) | Transactional outbox, at-least-once delivery, order-independent projection |
| Data migration | [`db/migrations/`](../db/migrations), [`tests/migration/`](../tests/migration) | v1 -> v2 migration, record counts, checksums, field-level reconciliation, quarantine, report |
| Security (OWASP ZAP) | [`security/run-zap.sh`](../security/run-zap.sh), [`docs/security-triage.md`](security-triage.md) | Localhost-only scans, High-risk gate, triage of every finding (one real bug fixed) |
| Performance (k6) | [`performance/`](../performance), [`docs/performance-results.md`](performance-results.md) | Load, stress, spike scripts, thresholds as gates, written analysis |
| Resilience | [`tests/resilience/resilience.test.ts`](../tests/resilience/resilience.test.ts), [`docker-compose.yml`](../docker-compose.yml) | Toxiproxy latency and cuts on HTTP, broker and database; found a crash bug in the DB pool |
| Azure DevOps CI/CD | [`azure-pipelines.yml`](../azure-pipelines.yml) | Multi-stage pipeline with JUnit and coverage publishing |
| GitHub Actions (public CI) | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Same pipeline running publicly, parallel jobs, artifacts, step summary |
| Quality gates | `vitest.config.ts` (coverage), `ci.yml` (smoke gate), `performance/*.js` (thresholds), `scripts/zap-gate.ts` | Coverage 90/85/90, zero failed smoke tests, k6 thresholds, no High ZAP alerts |
| Test reporting | [`scripts/quality-summary.ts`](../scripts/quality-summary.ts), [`docs/release-readiness-report.md`](release-readiness-report.md) | Generated quality summary; go/no-go report using real results |
| Defect triage and RCA | [`docs/defects/`](defects), [`docs/root-cause-analysis.md`](root-cause-analysis.md), [`docs/defect-report-template.md`](defect-report-template.md) | Four defect reports with severity and evidence; full RCA with 5 Whys and prevention actions |
| AI-assisted testing | [`ai-testing/`](../ai-testing) | Anthropic API test-idea generator and triage suggester, JSON-schema validation, de-duplication, review-folder-only output, mocked tests |
| Docker | [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml) | One-command stack: Postgres, RabbitMQ, three services, web, optional Toxiproxy profile |
| Mentoring | [`docs/mentoring-guide.md`](mentoring-guide.md) | Four-week onboarding plan with exercises, pitfalls and a review checklist |
| Documentation | [`docs/`](.), [`README.md`](../README.md) | Strategy, plan, acceptance criteria, testability review, OpenAPI specs in `services/*/openapi.yaml` |
| Testability / design review | [`docs/testability-review.md`](testability-review.md) | What makes the system easy or hard to test and what to change |
| Unit testing (boundaries, rounding) | [`tests/unit/`](../tests/unit) | Premium and co-insurance maths, 100% coverage of the core |
