# Mentoring guide: onboarding a junior QA engineer

A four-week path using this repository as the learning ground. Goal: by the end, the engineer can add a
well-designed test at the right level, write a clear defect report and explain why they chose it.

## How to run the programme
- One 30 minute pairing session each week, plus a short review of whatever they ship.
- Always ask "what could go wrong, and how would we know?" before "what should I automate?".
- Review for **thinking** first (is this the right test?) then for code style.
- Celebrate a good defect report as much as a good test.

## Week 1: Understand the product and the risks
**Read:** [README](../README.md), [test-strategy.md](test-strategy.md), [risk-based-test-plan.md](risk-based-test-plan.md), [acceptance-criteria.md](acceptance-criteria.md).

**Do:**
1. Run `npm run dev` and use the UI: submit a risk, quote, bind, notify a claim, assess, settle.
2. Draw the flow on paper: which service handles each step, which events are published?
3. Look at the data: connect to the database (or `reports/` output) and find the rows your journey created.
4. Pick three risks from the register and explain in your own words why they score high.

**Check yourself:** Why is a premium error rated higher than a slow page?

## Week 2: Test design and unit/API testing
**Read:** `tests/unit/pricing.test.ts`, `tests/api/quote-api.spec.ts`.

**Do:**
1. Find the boundary values for the insured value and write down all the test cases before coding.
2. Add one new unit test and one new API test using the builders. Tag it `@regression`.
3. Break the code on purpose (change `>=` to `>`), watch the right test fail, then revert.

**Concepts:** equivalence partitions, boundary values, test pyramid (lowest level that can catch it), arrange-act-assert.

**Pitfalls:** asserting on messages instead of codes; sharing state between tests; floating point money.

## Week 3: Integration, data and events
**Read:** `tests/sql/`, `tests/events/events.test.ts`, `tests/contract/contract.test.ts`, [root-cause-analysis.md](root-cause-analysis.md).

**Do:**
1. Write a new SQL check that returns offending rows (for example "no policy has more than 10 insurers").
2. Explain, using the event tests, what *idempotent* and *eventually consistent* mean. Then explain why we poll with a timeout rather than `sleep(2000)`.
3. Change the shape of a field in policy-service's response and see which Pact test fails. Explain what a contract test protects.

**Pitfalls:** flaky waits; testing the happy path only; trusting a passing test without checking it can fail (use a positive control).

## Week 4: UI, non-functional and communication
**Read:** `tests/e2e/`, `performance/load.js`, [defects/](defects/), [defect-report-template.md](defect-report-template.md).

**Do:**
1. Add a Page Object method and one E2E test. Keep it to the journey, not every field.
2. Read the k6 thresholds. Explain what p95 means and why we gate on it.
3. Find and write up a new defect (or a testability issue) using the template, with steps anyone can reproduce.
4. Present: "the riskiest thing about this system and how we test it" in five minutes.

## What good looks like
| Area | Not yet | Good |
| --- | --- | --- |
| Test names | `test1` | Describe behaviour: "rejects a claim above the sum insured" |
| Assertions | one `toBeTruthy()` | Specific values and error codes |
| Data | hard-coded ids | Builders, unique data per test |
| Waiting | `sleep` | Poll with timeout, or deterministic trigger (`flush`) |
| Defect reports | "It does not work" | Steps, expected vs actual, evidence, impact |
| Automation choice | "automate everything" | "this belongs at the unit/API level because..." |

## Review checklist for their pull requests
- [ ] Is the test at the right level of the pyramid?
- [ ] Does it fail for the right reason? (Has it ever been red?)
- [ ] Is it independent and repeatable?
- [ ] Could the next person understand the failure message?
- [ ] Does it map to a story or a risk?

## Reading list
- *Explore It!* (Elisabeth Hendrickson); *Lessons Learned in Software Testing* (Kaner, Bach, Pettichord).
- Playwright docs: best practices. Pact docs: consumer-driven contracts. k6 docs: thresholds.
- Martin Fowler: test pyramid; "Eradicating Non-Determinism in Tests".

## For the mentor: signs to step in
Writing tests that restate the code, copy-pasting selectors, silencing a failing test instead of understanding
it, or going quiet for more than a day when blocked.
