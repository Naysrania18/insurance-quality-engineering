# DEF-001: Insurer shares do not add up to the policy premium

| Field | Value |
| --- | --- |
| ID | DEF-001 |
| Status | Confirmed (open, guarded by expected-failure tests) |
| Severity | **Major** (money is wrong, even if only by cents) |
| Priority | P1 |
| Category | data-integrity |
| Component | policy-service, premium split on bind |
| Found by | `tests/sql/validation.test.ts` (premium equals sum of shares), also API, E2E and unit tests |

## Summary
When a policy is bound, the premium is divided across the co-insurance panel, but the amounts each insurer is
charged can add up to a few cents more or less than the premium. The books then do not reconcile between the
policy and its insurers.

## Steps to reproduce
1. Submit a marine cargo risk worth `1000070` cents (10,000.70) and quote it. Premium is `8001` cents.
2. Bind the quote with the default panel (33.33% / 33.33% / 33.34%).
3. Add up `shares[].amountCents` in the response.

```bash
curl -s -X POST localhost:3002/policies -H 'content-type: application/json' -d '{"quoteId":"<quote id>"}'
```

## Expected result
`2667 + 2667 + 2667 = 8001`. The amounts sum exactly to the premium (largest-remainder allocation).

## Actual result
`2667 + 2667 + 2668 = 8002`. The shares total 8002, one cent over the 8001 premium.

## Evidence
- SQL: `premiumEqualsSumOfShares` in `tests/sql/checks.ts` returns the policy (`total_premium_cents=8001`, `shares_total=8002`).
- Playwright E2E: the UI shows shares adding to 80.02 for an 80.01 premium.
- Unit: `splitPremium(1001, DEFAULT_PANEL)` sums to 1002.

## Impact and risk
Every policy whose premium does not divide evenly is affected, which is most of them. Each is off by one cent
or so. The amount is small but it breaks reconciliation with insurers and bordereaux, so finance has to
investigate each break. This is a trust and audit problem. See risk R-02 in `risk-based-test-plan.md`.

## Suspected cause
`splitPremium` rounds each share with `Math.round`. Independent rounding does not preserve the total. The shared
`allocateShares` function already handles this and is covered by unit tests, but it is not called.

## Workaround
None for users. Finance can adjust the lead insurer's share by the difference.

## Regression tests
- `tests/unit/coinsurance.test.ts` DEF-001 (`it.fails`)
- `tests/sql/validation.test.ts` DEF-001 (`it.fails`) plus a positive-control test
- `tests/api/policy-claims-api.spec.ts` DEF-001 (`test.fail`)
- `tests/e2e/journeys.spec.ts` DEF-001 (`test.fail`)

## Triage notes
Fix is a one-line change in `split.ts`. Root cause analysis: [../root-cause-analysis.md](../root-cause-analysis.md).
