# DEF-002: The same claim can be notified twice

| Field | Value |
| --- | --- |
| ID | DEF-002 |
| Status | Confirmed (open, guarded by expected-failure tests) |
| Severity | **Major** (risk of paying a claim twice) |
| Priority | P1 |
| Category | functional / data-integrity |
| Component | claims-service, `POST /claims` |
| Found by | `tests/api/policy-claims-api.spec.ts` DEF-002, `tests/sql/validation.test.ts` DEF-002 |

## Summary
Notifying a claim with the same policy, loss date and amount returns `201 Created` every time. Two claim
records are created for one loss, so an assessor could settle both.

## Steps to reproduce
1. Bind any policy.
2. `POST /claims` with `{policyId, lossDate:"2026-01-15", amountClaimedCents:1000000, description:"x"}`.
3. Send the identical request again (a double-click, a retried request after a timeout, or a broker resubmitting).

## Expected result
The second request is rejected with `409 duplicate_claim` and no second row is created.

## Actual result
`201 Created` with a new claim id and a new claim reference. The `duplicateClaims` SQL check lists the pair.

## Impact and risk
Duplicate payments or inflated reserves. Retried requests after network timeouts make this likely in
production. A client that retries a timed-out request would create duplicates every time. See risk R-03.

## Suspected cause
There is no uniqueness rule or pre-insert check on `(policy_id, loss_date, amount_claimed_cents)`, and no
idempotency key on the endpoint.

## Suggested fix
Enforce in the database as well as the code: a unique index (or constraint) plus a clear 409, and add an
optional `Idempotency-Key` header so legitimate retries return the original claim.

## Regression tests
- `tests/api/policy-claims-api.spec.ts` DEF-002 (`test.fail`)
- `tests/sql/validation.test.ts` DEF-002 (`it.fails`)
