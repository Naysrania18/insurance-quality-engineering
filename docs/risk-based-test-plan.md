# Risk-based test plan

**Scoring:** Likelihood (1-5) x Impact (1-5) = Score. 15+ is High (deepest testing), 8-14 Medium, below 8 Low.
Likelihood reflects how easily the failure could happen in this design; impact reflects financial, regulatory
and customer harm.

## Risk register

| ID | Feature | Risk | L | I | Score | Test approach | Coverage (where) | Status |
| --- | --- | --- | -: | -: | -: | --- | --- | --- |
| R-01 | Premium calculation | Wrong premium from rate, loading or rounding errors | 4 | 5 | **20** | Boundary and rounding unit tests; API checks of known premiums; Newman check of a worked example; property-style monotonic test | `tests/unit/pricing.test.ts`, `tests/api/quote-api.spec.ts`, `tests/postman/` | Covered. DEF-004 open |
| R-02 | Co-insurance share split | Shares do not add up to the premium, or do not total 100% | 4 | 5 | **20** | Unit tests of `allocateShares` over 5,000 premiums; panel validation cases; SQL invariant on every policy; E2E check of displayed amounts | `tests/unit/coinsurance.test.ts`, `tests/sql/`, `tests/api/policy-claims-api.spec.ts`, `tests/e2e/` | Covered. DEF-001 open |
| R-03 | Claim notification | Duplicate claims are accepted and may be paid twice | 4 | 5 | **20** | API duplicate test; SQL duplicate check; retry after timeout scenario (resilience) | `tests/api/`, `tests/sql/`, `tests/resilience/` | Covered. DEF-002 open |
| R-04 | Events (PolicyBound, ClaimNotified, ClaimSettled) | An event is lost when the broker is down, so downstream state is wrong | 3 | 5 | **15** | Transactional outbox; test with a failing broker then recovery; resilience test with Toxiproxy cutting the broker | `tests/events/`, `tests/resilience/` | Covered |
| R-05 | Audit trail | A state change has no audit_log entry | 3 | 5 | **15** | SQL check per entity and state; positive control proving the check can fail | `tests/sql/validation.test.ts` | Covered. DEF-003 open |
| R-06 | Event consumers | Duplicate or out-of-order messages corrupt policy claim counters | 4 | 4 | **16** | Idempotency test; reversed-order and property test; poison-message dead-lettering | `tests/events/events.test.ts` | Covered |
| R-07 | Claim state machine | Illegal transitions (settle before assess, settle twice) or over-payment | 3 | 5 | **15** | API transition matrix; amount limit checks (assessed <= claimed <= sum insured) | `tests/api/policy-claims-api.spec.ts`, Newman | Covered |
| R-08 | Binding | Same quote bound twice under concurrency | 3 | 5 | **15** | Parallel bind test; database unique constraint | `tests/api/` | Covered |
| R-09 | Data migration v1 -> v2 | Records lost, amounts changed or shares broken in migration | 3 | 5 | **15** | Counts, totals checksum, normalised-record hash and field-level reconciliation; quarantine of bad rows; test that reconciliation detects tampering | `tests/migration/` | Covered |
| R-10 | Service dependency | claims-service hangs or corrupts data when policy-service is slow or down | 3 | 4 | 12 | Client timeout; Toxiproxy latency and cut tests; no half-created claim | `tests/resilience/`, `tests/contract/` | Covered |
| R-11 | Contract drift | policy-service changes a field claims-service relies on | 3 | 4 | 12 | Pact consumer-driven contract with provider verification | `tests/contract/` | Covered |
| R-12 | Input handling and security | Injection, malformed input, information leakage, missing headers | 2 | 5 | 10 | Negative API cases; ZAP API scans; security header assertions | `tests/api/quote-api.spec.ts`, `security/` | Covered; no authN/authZ in demo (accepted) |
| R-13 | Throughput | Latency or errors under peak broker submissions | 3 | 3 | 9 | k6 load, stress and spike with thresholds | `performance/` | Covered |
| R-14 | Broker/underwriter UI | Users cannot complete the journey or see wrong numbers | 3 | 3 | 9 | Smoke journey plus validation checks; displayed values compared to API | `tests/e2e/` | Covered |
| R-15 | Quote workflow | A risk is quoted twice, or a quote is orphaned | 2 | 4 | 8 | State checks and concurrency test | `tests/api/quote-api.spec.ts` | Covered |
| R-16 | AI-assisted tooling | Generated tests are wrong or auto-added to the suite | 2 | 3 | 6 | Schema validation, de-duplication, review-folder-only output, human gate | `ai-testing/` | Covered |

## How this drove the work
- The three highest scores (R-01, R-02, R-03) are all about money and duplicates, and they are exactly where
  defects were found.
- Eventual consistency (R-04, R-06) has the highest *effort* because it needs ordering, duplication and outage
  scenarios, not just a happy path.
- Low-scoring items (R-15, R-16) get fewer, cheaper tests.

## What is deliberately not covered
Authentication, authorisation and rate limiting do not exist in the demo; they are listed in
[testability-review.md](testability-review.md) as future work. Real payment or bordereaux interfaces are not
modelled.

## Review cadence
Re-score after every release and after every production incident. A new defect raises the likelihood of its
neighbours (a share-rounding bug raises the likelihood of other rounding bugs).
