# DEF-003: Settling a claim leaves no audit trail entry

| Field | Value |
| --- | --- |
| ID | DEF-003 |
| Status | Confirmed (open, guarded by expected-failure tests) |
| Severity | **Critical** for a regulated insurer (missing audit trail on a payment decision) |
| Priority | P1 |
| Category | data-integrity / compliance |
| Component | claims-service, `POST /claims/:id/settle` |
| Found by | `tests/sql/validation.test.ts` DEF-003 (`claimsMissingAuditForState`) |

## Summary
Every state change in the platform writes a row to `audit_log`, except moving a claim from `ASSESSED` to
`SETTLED`. The settlement itself, the step that results in money leaving the business, is not recorded.

## Steps to reproduce
1. Bind a policy, notify a claim, assess it, settle it (API or UI).
2. `SELECT to_state FROM audit_log WHERE entity='claim' AND entity_id = '<claim id>' ORDER BY id;`

## Expected result
Three rows: `NOTIFIED`, `ASSESSED`, `SETTLED`.

## Actual result
Two rows: `NOTIFIED`, `ASSESSED`. There is no record of the settlement in the audit table.

## Evidence
The control test `control: the only missing audit states are SETTLED` shows the gap is isolated to this one
transition, so the rest of the audit logging works.

## Impact and risk
Cannot prove who or when a claim was settled from the audit table. Regulatory and internal-audit exposure.
The `ClaimSettled` event is still published, so downstream systems know, but the system of record does not.
See risk R-05.

## Suspected cause
The `audit(...)` call is missing in the settle handler. Each handler repeats the audit call by hand, so a
missed call is not caught by the compiler or by the database.

## Suggested fix
Add the call now. Longer term, write audit rows from a database trigger or a single state-transition helper so
a handler cannot forget (see the RCA prevention actions).

## Regression test
`tests/sql/validation.test.ts` DEF-003 (`it.fails`)
