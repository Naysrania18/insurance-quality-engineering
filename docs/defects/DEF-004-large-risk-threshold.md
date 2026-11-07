# DEF-004: Large-risk loading is skipped at exactly 1,000,000.00

| Field | Value |
| --- | --- |
| ID | DEF-004 |
| Status | Confirmed (open, guarded by expected-failure tests) |
| Severity | Major (under-charged premium) |
| Priority | P2 |
| Category | functional |
| Component | `shared/src/pricing.ts` `calculatePremiumCents` |
| Found by | unit boundary test, `tests/api/quote-api.spec.ts` DEF-004 |

## Summary
Risks of 1,000,000.00 or more should carry a 10% loading. The code applies it only above that value, so a risk of
exactly 1,000,000.00 is quoted 10% too low.

## Steps to reproduce
Quote a marine cargo risk with `insuredValueCents = 100000000`.

## Expected result
`880000` cents (8,800.00: 0.80% x 1.10). The business rule says "at or above".

## Actual result
`800000` cents (8,000.00).

## Impact and risk
A classic boundary error. The loss per affected risk is 800.00, but only risks at the exact boundary are
affected, which makes it rare in production and easy to miss without boundary tests. Brokers who round their
values to 1,000,000 are the likely group.

## Suspected cause
`insuredValueCents > LARGE_RISK_THRESHOLD_CENTS` should be `>=`.

## Regression tests
- `tests/unit/pricing.test.ts` DEF-004 (`it.fails`) next to the passing tests for 999,999.99 and 1,000,000.01
- `tests/api/quote-api.spec.ts` DEF-004 (`test.fail`)
