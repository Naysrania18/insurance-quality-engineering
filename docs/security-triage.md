# Security testing and ZAP triage

**Scope and safety:** OWASP ZAP runs in Docker against the **local** demo services only
(`localhost:3001-3003`, enforced in `security/run-zap.sh`, which refuses any other host). It uses the API scan
mode driven by each service's OpenAPI document. No external system is ever scanned.

How to run: `docker compose up --build -d && npm run seed && bash security/run-zap.sh`.
Reports are written to `reports/zap/` (HTML, JSON, Markdown) and summarised in `reports/zap-summary.md`.

**Quality gate:** the pipeline fails on any High-risk alert (`scripts/zap-gate.ts`).

## Result of the first scan (CI run on 2026-11-07)

| Service | High | Medium | Low | Informational |
| --- | ---: | ---: | ---: | ---: |
| quote | 0 | 0 | 2 | 2 |
| policy | 0 | 0 | 1 | 2 |
| claims | 0 | 0 | 1 | 2 |

## Triage of each finding

| # | Finding (plugin) | Risk | Service | Verdict | Action |
| --- | --- | --- | --- | --- | --- |
| S1 | A Server Error response code was returned (100000) | Low | quote | **True positive, real bug.** `GET /risks?status=%00` sent a NUL byte to PostgreSQL, which rejected it, so the API answered `500`. | **Fixed**: `status` is validated against an allow-list (SUBMITTED, QUOTED, BOUND) and returns 400 otherwise. Regression test: "rejects a NUL byte in a query parameter with 400". The older "SQL injection" test now expects 400 too. |
| S2 | Cross-Origin-Resource-Policy header missing or invalid (90004) | Low | all | True positive (hardening gap) | **Fixed**: `Cross-Origin-Resource-Policy: same-origin` is now sent on every response. |
| S3 | A Client Error response code was returned (100000) | Informational | all | Expected. ZAP deliberately sends invalid input and the API correctly answers 400/404/409/422. | No action. This is the validation tests' behaviour seen from the outside. |
| S4 | Non-Storable Content (10049) | Informational | all | Expected and desired. Responses carry `Cache-Control: no-store` because they contain financial data. | No action. |

## Why the severity matters
The only functional problem (S1) was rated Low by ZAP, but it is a *reliability* bug: unvalidated input reaches the
database. In another endpoint the same pattern could become an injection risk, so it was fixed as a class
(all query parameters are validated: enum for `status`, UUID for `riskId`/`policyId`).

## What this scan does not cover
- **Authentication and authorisation:** the demo has none (listed in [testability-review.md](testability-review.md)).
  A real system needs authorisation tests (broker A cannot see broker B's risks), which ZAP cannot invent.
- **Business-logic abuse** (duplicate claims, DEF-002) is a functional risk covered by API tests, not by a scanner.
- **The web UI** is static and served same-origin; a ZAP baseline scan of the UI is a suggested extension.
- **Dependency vulnerabilities:** `npm audit` currently reports 0 vulnerabilities; an SCA step is a suggested pipeline addition.

## Other security checks in the suite
| Check | Where |
| --- | --- |
| SQL injection attempt in a query parameter is not executed | `tests/api/quote-api.spec.ts` |
| Malformed JSON gives 400 with no stack trace | `tests/api/quote-api.spec.ts` |
| Security headers (`nosniff`, `X-Frame-Options`, no `X-Powered-By`) | `tests/api/quote-api.spec.ts` |
| Database failure returns a clean 5xx with no stack trace or paths | `tests/resilience/resilience.test.ts` |
| Secrets: gitleaks scan of the full history before publishing | see README |
