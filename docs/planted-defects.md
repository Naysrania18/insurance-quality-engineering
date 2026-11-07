# Planted defects

This repository's system under test is a **demo platform built for testing practice**. Four defects were
planted on purpose so the test suites have real issues to find. They are documented here (and in the defect
reports) so reviewers can see exactly what the tests are expected to catch.

| ID | Where | What is wrong | Caught by | Report |
| --- | --- | --- | --- | --- |
| DEF-001 | `services/policy-service/src/split.ts` | Each insurer share is rounded independently, so shares can add up to a different total than the premium (e.g. 1001 cents splits as 334 + 334 + 334 = 1002). The correct `allocateShares` exists in `shared/` but the bind path does not use it. | SQL validation, API test, E2E test, unit test of `splitPremium`, migration-style reconciliation query | [DEF-001](defects/DEF-001-share-rounding.md) |
| DEF-002 | `services/claims-service/src/app.ts` (`POST /claims`) | No duplicate-claim check: the same policy, loss date and amount can be notified twice. | API test, SQL duplicate check | [DEF-002](defects/DEF-002-duplicate-claims.md) |
| DEF-003 | `services/claims-service/src/app.ts` (`POST /claims/:id/settle`) | The `ASSESSED -> SETTLED` transition writes no `audit_log` row. | SQL audit-trail check | [DEF-003](defects/DEF-003-missing-settlement-audit.md) |
| DEF-004 | `shared/src/pricing.ts` | The large-risk loading uses `>` instead of `>=`, so a risk of exactly 1,000,000.00 is under-charged by 10%. | Unit boundary test, API test | [DEF-004](defects/DEF-004-large-risk-threshold.md) |

## How the pipeline stays green while defects exist

Each defect has a test that asserts the **correct** behaviour. While the defect exists the test is marked as an
*expected failure*, with a comment linking to the report:

- Vitest: `it.fails('DEF-001: ...')`
- Playwright: `test.fail(true, 'DEF-001: ...')`

An expected-failure test that unexpectedly **passes** turns the build red. That is the signal to fix the report,
remove the marker and close the defect. Positive-control tests (for example in `tests/sql/validation.test.ts`)
prove each expected failure is failing for the right reason and not because of a broken query.

## Fixing a defect (exercise)

1. Fix the code (for DEF-001: call `allocateShares` from `split.ts`).
2. Run the suites. The matching expected-failure tests now "unexpectedly pass" and fail the build.
3. Remove `.fails` / `test.fail`, and the positive control, and update the defect report to *Fixed*.
