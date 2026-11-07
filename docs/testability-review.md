# Testability review

A design review of the demo platform from a quality point of view: what already makes it easy to test, what
made it hard, and what should change. Testability = how cheaply we can control the system's inputs and observe
its outputs.

## 1. What is already testable (and why)

| Design choice | Testability benefit |
| --- | --- |
| Money as integer cents, pure `calculatePremiumCents` / `allocateShares` | Deterministic unit tests, exact assertions, no float tolerance |
| App factories take dependencies (`createClaimsApp(db, policyClient)`) | Any service can be started in-process with a fake or real collaborator |
| `Db` interface with Postgres and in-process (PGlite) implementations | Full stack runs with no Docker; same SQL, same assertions in CI |
| `EventBus` interface with in-memory and RabbitMQ implementations | Event tests run in milliseconds and against the real broker with the same code |
| Transactional outbox + `flushEvents()` | Tests trigger delivery deliberately instead of sleeping |
| `processOnce` idempotency helper, order-independent projection | Duplicate and out-of-order behaviour is provable |
| Every endpoint described in OpenAPI and served at `/openapi.yaml` | Scanners (ZAP) and contract tooling consume the spec directly |
| Stable `data-testid` attributes in the UI | Selectors do not break when styling changes |
| `/health` on every service | Cheap readiness checks for orchestration and CI |
| Error responses share one shape `{error:{code,message}}` | Assertions on codes, not on message text |

## 2. Testability problems found

| # | Problem | Effect on testing | Severity |
| --- | --- | --- | --- |
| T1 | The rule "shares sum to the premium" is not enforced by the database | Only a data test can catch it (DEF-001) | High |
| T2 | Audit writes are hand-coded in each handler | A missed call is silent (DEF-003); tests must check every transition | High |
| T3 | No idempotency key on `POST /claims` | Retries cannot be made safe, duplicates are accepted (DEF-002) | High |
| T4 | Services share one database and read each other's tables (policy-service reads quotes and risks) | Services cannot be tested or deployed in isolation; schema changes break others | Medium |
| T5 | No clock abstraction: "loss date cannot be in the future" uses the real clock | Date boundary tests depend on today | Medium |
| T6 | Consumer queue names and processed-event keys are fixed constants (parameterised only in tests) | Tests had to add a parameter to run consumers side by side | Low |
| T7 | No correlation/trace id across services | Hard to follow one claim through API -> outbox -> broker -> consumer in logs | Medium |
| T8 | Eventual consistency has no observable "caught up" marker | Tests poll with timeouts; flaky if the timeout is too tight | Medium |
| T9 | No authentication or rate limiting | Security tests cannot cover authorisation; load tests cannot model users | Medium |
| T10 | Premium and share logic lives in two places (`shared/` and `split.ts`) | Tests for one do not protect the other (see RCA) | High |

## 3. Recommended improvements

| Improvement | Fixes | Effort | Test benefit |
| --- | --- | --- | --- |
| Single money-splitting function; delete `split.ts` | T10, T1 | S | Removes DEF-001 |
| Database check or trigger on `SUM(shares) = premium`; trigger-based audit log | T1, T2 | M | Whole classes of defect become impossible, tests become a safety net not the only defence |
| `Idempotency-Key` header and unique index on claims | T3 | S | Safe retries; deterministic API tests |
| Inject a `Clock` into services | T5 | S | Time-travel tests for loss dates, policy periods |
| Per-service schemas/ownership and API-only reads between services | T4 | L | Contract tests replace shared-table assumptions; independent test environments |
| Propagate `x-correlation-id` through HTTP and events | T7 | S | One id to grep for in logs and test failures |
| Expose consumer lag/"last processed event" on a diagnostics endpoint | T8 | S | Tests wait for a signal rather than guessing a timeout |
| Add simple authentication and roles (broker / underwriter / handler) | T9 | M | Authorisation tests, realistic ZAP scans |
| Structured JSON logging with event ids | T7 | S | Faster diagnosis from CI logs |
| Feature flags to switch planted defects off | n/a | S | Lets reviewers run "defect present" and "defect fixed" builds from one codebase |

## 4. Testability checklist used in review
- [ ] Can I set up the exact state I need in under a second without going through the UI?
- [ ] Can I observe the result without waiting for a fixed time?
- [ ] Can I replace each collaborator (database, broker, other service, clock)?
- [ ] Do failures say *which record or rule* broke?
- [ ] Is every business invariant enforced somewhere that does not depend on a test?
- [ ] Is there one implementation of each business rule?
