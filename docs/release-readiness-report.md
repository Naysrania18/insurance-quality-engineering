# Release readiness report

## Part 1: Template

Copy the structure below for each release candidate.

```
Release: <name/version, commit>     Date: <date>     Prepared by: <name>
Decision: GO / NO-GO / GO WITH CONDITIONS

1. Scope of the release (stories, changes)
2. Test results by level (tests, failed, skipped/expected failures, trend vs last release)
3. Coverage and gates (unit coverage, smoke, performance thresholds, security gate)
4. Open defects by severity (id, severity, workaround, owner, accepted by whom)
5. Risks (from the risk register: covered / partially covered / not covered)
6. Non-functional results (performance, resilience, security)
7. Data and migration status
8. Known limitations and conditions
9. Decision and sign-off (QA, Product, Engineering)
```

**Go/no-go rules used here**
- NO-GO if any Critical defect is open, or a Major defect affects money, claims payments or the audit trail without a signed-off workaround.
- NO-GO if a quality gate is red (smoke, k6 thresholds, High ZAP alert, coverage, reconciliation).
- GO WITH CONDITIONS if only Minor defects are open and each has an owner and date.

---

## Part 2: Filled example (this repository, release candidate `main`)

Release: demo platform v1.0.0 (the portfolio build)    Date: 2026-11-07
Prepared by: QA    **Decision: NO-GO for production use** (this is a demo; the decision shows the method)

### 1. Scope
Broker risk submission, underwriter quoting, binding with co-insurance, claim notification, assessment and
settlement, event propagation to the policy, v1 -> v2 data migration. See [acceptance-criteria.md](acceptance-criteria.md).

### 2. Test results (from the CI run on `main`, GitHub Actions)

| Level | Tests | Passed | Expected failures (open defects) | Unexpected failures |
| --- | ---: | ---: | ---: | ---: |
| Unit (Vitest) | 35 | 33 | 2 | 0 |
| API (Playwright) | 41 | 38 | 3 | 0 |
| UI / E2E (Playwright) | 6 | 5 | 1 | 0 |
| Postman / Newman | 15 requests, 17 assertions | 17 | 0 | 0 |
| Contract (Pact, consumer + provider) | 3 | 3 | 0 | 0 |
| SQL data validation | 16 | 13 | 3 | 0 |
| Event-driven | 9 | 9 | 0 | 0 |
| Data migration + reconciliation | 15 | 15 | 0 | 0 |
| Resilience (Toxiproxy) | 5 | 5 | 0 | 0 |
| AI tool (mocked LLM) | 13 | 13 | 0 | 0 |

"Expected failure" means the test asserts the correct behaviour and is marked `it.fails` / `test.fail` because
the defect is known. See [planted-defects.md](planted-defects.md).

### 3. Gates

| Gate | Threshold | Result | Status |
| --- | --- | --- | --- |
| Unit coverage (calculation core) | lines 90, branches 85, functions 90 | 100 / 100 / 100 | PASS |
| Smoke tests | 0 failures | 0 failures | PASS |
| k6 thresholds (load, stress, spike) | error < 1%/5%, p95 within budget | 0% errors; p95 7 ms / 64 ms / 126 ms | PASS |
| OWASP ZAP | no High alerts | 0 High, 0 Medium | PASS |
| Migration reconciliation | counts, checksums, field-level all match | PASS (3 bad legacy rows quarantined, 0 diffs) | PASS |

### 4. Open defects

| ID | Severity | Summary | Workaround | Blocks release? |
| --- | --- | --- | --- | --- |
| DEF-003 | Critical | Settlement writes no audit_log entry | None; audit trail has a gap on payments | **Yes** |
| DEF-001 | Major | Insurer shares can differ from premium by cents | Manual adjustment by finance | **Yes** (money reconciliation) |
| DEF-002 | Major | Duplicate claims accepted | Handler checks for duplicates by hand | **Yes** (risk of double payment) |
| DEF-004 | Major | Risks of exactly 1,000,000.00 not loaded | Underwriter overrides the premium | No, rare boundary, but should be fixed in the same release |

Defects found and fixed during testing: pg connection-pool crash on dropped connections (found by resilience tests),
and a 500 on a NUL byte in a query string (found by ZAP).

### 5. Risk coverage
All 16 risks in [risk-based-test-plan.md](risk-based-test-plan.md) have tests. The three highest risks
(R-01, R-02, R-03) each have an open defect, which is why the decision is NO-GO.

### 6. Non-functional
- **Performance:** no errors up to 100 virtual users on a small shared runner. See [performance-results.md](performance-results.md).
- **Resilience:** slow or unreachable policy-service gives a fast 503 with no partial claim; broker outage loses no events (outbox); database outage gives a clean 5xx and recovers.
- **Security:** see [security-triage.md](security-triage.md). No authentication in the demo (accepted for a demo, a blocker for a real system).

### 7. Data and migration
Legacy rows read 201, migrated 198, quarantined 3 with reasons. Premium totals and record hash match; zero field differences.

### 8. Known limitations
No authentication/authorisation, single Chromium browser, short CI performance runs, shared database across services.

### 9. Decision
**NO-GO** until DEF-003, DEF-001 and DEF-002 are fixed and their expected-failure markers are removed (the tests
then become regression guards). Re-run the full pipeline and re-issue this report. Conditions for GO: all Critical
and Major money/audit defects closed, gates green, DEF-004 fixed or signed off.

| Role | Name | Date |
| --- | --- | --- |
| QA | (to be filled) | |
| Product | (to be filled) | |
| Engineering | (to be filled) | |
