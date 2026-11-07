# Defect report template

Copy this file to `docs/defects/DEF-NNN-short-name.md`.

| Field | Value |
| --- | --- |
| ID | DEF-NNN |
| Title | One line: what is wrong, where |
| Status | New / Confirmed / In progress / Fixed / Won't fix |
| Severity | Critical / Major / Minor / Trivial (impact on the business) |
| Priority | P1 / P2 / P3 (urgency to fix) |
| Category | functional / data-integrity / integration / performance / security / usability |
| Component | service / module |
| Found by | test name or exploratory session |
| Environment | version / commit, stack mode |

## Summary
Two sentences a product owner can read.

## Steps to reproduce
1. Numbered, minimal, copy-pasteable (curl or UI steps)

## Expected result
## Actual result
## Evidence
Logs, SQL output, screenshots, failing test name.

## Impact and risk
Who is affected, financial/regulatory exposure, how likely.

## Suspected cause
## Workaround
## Regression test
Link to the test that guards this defect.

## Triage notes
Decision, owner, target release.
