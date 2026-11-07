# Root cause analysis: premium shares did not add up (DEF-001)

| Field | Value |
| --- | --- |
| Incident | Insurer share amounts differ from the policy premium by one or more cents |
| Defect | [DEF-001](defects/DEF-001-share-rounding.md) |
| Detected by | SQL data validation (`premiumEqualsSumOfShares`) |
| Severity | Major |
| Status | Root cause identified, fix and prevention actions proposed |

## 1. What happened
Policies whose premium does not divide evenly across the co-insurance panel were bound with insurer amounts that
add up to a different figure than the premium. Example: premium 80.01, shares 26.67 + 26.67 + 26.68 = 80.02.

## 2. Timeline (demo scenario)
| Step | Event |
| --- | --- |
| Design | A correct `allocateShares` (largest remainder) was written and unit tested in `shared/` |
| Implementation | The bind endpoint was written with a local `splitPremium` that rounds each share |
| Testing | Unit tests passed (they tested `allocateShares`). API tests passed for round premiums |
| Detection | The SQL invariant over all policies found the mismatch; a chosen odd-cent premium reproduced it |

## 3. Impact
Every policy with an indivisible premium (most) is off by cents. Insurer statements and the policy no longer
reconcile. The amounts are small but the problem is systemic and visible to finance and auditors.

## 4. Five Whys
1. **Why did the shares not add up?** Each share was rounded independently, and independent rounding does not preserve the total.
2. **Why were they rounded independently?** `splitPremium` in policy-service uses `Math.round(total * bps / 10000)` per insurer.
3. **Why did policy-service not use the correct function?** The correct `allocateShares` lives in `shared/` and nothing connected the bind path to it; the developer wrote a local helper for speed.
4. **Why did the tests not catch it?** The unit tests covered `allocateShares`, not the function the endpoint actually calls, and the API tests used premiums that divide evenly (2,000.00 over 33.33/33.33/33.34 happens to add up).
5. **Why did we have no check that shares equal the premium?** The invariant existed only in people's heads. It was not written down as an acceptance criterion or a database/contract check, and there was no data-level test run on realistic, awkward values.

**Root cause:** the money-splitting rule was implemented twice, one version was untested, and the invariant
"shares sum to the premium" was not enforced anywhere (code, test or database).

## 5. Contributing factors
- Test data bias: round numbers hide rounding bugs.
- Duplicate implementation of a business rule.
- Unit coverage percentage looked healthy (100% of the calculation core) while the wrong function was in use. Coverage measured the correct code, not the used code.

## 6. Why it was found
A data invariant test over every policy, plus deliberately awkward values (insured value 10,000.70 giving an 80.01 premium).
Property-style testing of many premiums found the same class of issue in the unit layer.

## 7. Corrective action
Replace the local rounding with `allocateShares` in `split.ts` (one line). Then remove the expected-failure
markers on DEF-001 so the tests guard against regression.

## 8. Prevention actions
| # | Action | Type | Owner | Verification |
| --- | --- | --- | --- | --- |
| 1 | Delete `splitPremium`; the only way to split money is `allocateShares` | Design (single source of truth) | Dev | Search shows one implementation |
| 2 | Add a database constraint/trigger so `SUM(insurer_shares.amount_cents) = policies.total_premium_cents` is checked at commit | Safety net | Dev + DBA | Insert with bad shares fails |
| 3 | Add the invariant to acceptance criteria (US-3 AC3) and the Definition of Done | Process | QA + PO | Present in this repo |
| 4 | Run the SQL invariant suite against every environment daily, and alert | Monitoring | QA | Nightly job |
| 5 | Add property-based tests with random premiums at the API level | Test design | QA | New test exists |
| 6 | Review rule: any duplicated money logic is a review blocker | Process | Team | PR checklist |
| 7 | Use awkward test data by default in builders (odd cents) | Test data | QA | `RiskBuilder` default changed |

## 9. Lessons learned
- Passing tests on the correct code are worthless if the endpoint does not call that code.
- Coverage is not correctness: measure what matters (invariants) as well as lines.
- The cheapest fix is a single implementation; the cheapest detection is a data invariant run on awkward values.
