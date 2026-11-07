# Acceptance criteria

User stories for the demo platform in Given/When/Then form. Each story lists the tests that verify it.

## US-1 Broker submits a risk
**As a** broker **I want** to submit a risk **so that** an underwriter can quote it.

- **AC1** Given a valid broker and a marine cargo risk worth 250,000.00, when I submit it, then it is created with status `SUBMITTED`.
- **AC2** Given an insured value below 10,000.00 or above 50,000,000.00, when I submit, then it is rejected with a clear validation error and nothing is stored.
- **AC3** Given an empty description or an unknown risk type, when I submit, then it is rejected.
- **AC4** Given an unknown broker, when I submit, then I get a not-found error.

Tests: `tests/api/quote-api.spec.ts`, `tests/e2e/journeys.spec.ts`, Newman steps 03-04.

## US-2 Underwriter quotes a risk
**As an** underwriter **I want** a premium calculated from the risk **so that** I can offer a quote.

- **AC1** Given a marine cargo risk of 500,000.00, when I quote it, then the premium is 4,000.00 (0.80%).
- **AC2** Given a commercial property risk of 500,000.00, then the premium is 6,000.00 (1.20%).
- **AC3** Given an insured value of 1,000,000.00 or more, then a 10% large-risk loading applies. (DEF-004: the exact boundary is currently not loaded.)
- **AC4** Premiums are rounded half-up to the cent.
- **AC5** Given a risk that is already quoted, when I quote it again, then I get a conflict error and no second quote exists.
- **AC6** Given five simultaneous quote requests, then exactly one succeeds.

Tests: `tests/unit/pricing.test.ts`, `tests/api/quote-api.spec.ts`.

## US-3 Bind a policy with co-insurance
**As an** underwriter **I want** to bind a quote and split the premium across insurers **so that** each insurer carries its share.

- **AC1** Given a quoted risk, when I bind it with the default panel, then a `BOUND` policy is created and the quote becomes `ACCEPTED`.
- **AC2** Given the panel, then the insurer shares total exactly 100%.
- **AC3** Given the policy premium, then the insurer amounts add up exactly to the premium. (DEF-001: currently off by cents.)
- **AC4** Given a panel that does not total 100%, has a duplicate insurer or a zero share, then binding is rejected and the quote can still be bound afterwards.
- **AC5** Given a quote that is already bound, when I bind it again (including concurrently), then exactly one policy exists.
- **AC6** When a policy is bound, then a `PolicyBound` event is published once, and an audit entry exists for the policy, quote and risk.

Tests: `tests/unit/coinsurance.test.ts`, `tests/api/policy-claims-api.spec.ts`, `tests/sql/`, `tests/events/`.

## US-4 Notify a claim
**As a** broker **I want** to notify a claim against a policy **so that** it can be assessed.

- **AC1** Given a bound policy, when I notify a claim, then it is created `NOTIFIED` and a `ClaimNotified` event is published.
- **AC2** Given a claim above the sum insured, then it is rejected (422).
- **AC3** Given a loss date in the future or an invalid amount, then it is rejected.
- **AC4** Given an unknown policy, then I get not-found.
- **AC5** Given a claim with the same policy, loss date and amount as an existing one, then it is rejected as a duplicate. (DEF-002: currently accepted.)
- **AC6** Given policy-service is down or slow, then I get a 503 within the timeout and no partial claim is stored.

Tests: `tests/api/`, `tests/contract/`, `tests/resilience/`.

## US-5 Assess and settle a claim
**As a** claims handler **I want** to assess and settle claims **so that** the insured is paid the right amount.

- **AC1** Given a `NOTIFIED` claim, when I assess it for no more than the amount claimed, then it is `ASSESSED`.
- **AC2** Given an `ASSESSED` claim, when I settle it for no more than the assessed amount, then it is `SETTLED` and `ClaimSettled` is published.
- **AC3** Given a claim in the wrong state (settle before assess, assess twice, settle twice), then the action is refused with 409.
- **AC4** Given an assessment above the claim, or a settlement above the assessment, then it is refused (422).
- **AC5** Every state change, including settlement, has an `audit_log` entry. (DEF-003: settlement is not logged.)

Tests: `tests/api/`, `tests/sql/`, `tests/e2e/`.

## US-6 Policy reflects claims
**As an** underwriter **I want** the policy to show open claims and amounts paid **so that** I can see exposure.

- **AC1** Given a claim is settled, then within 15 seconds the policy shows `claimsPaidCents` equal to the settled amount and no open claims.
- **AC2** Given the same event is delivered twice, then it is applied once.
- **AC3** Given events arrive in the wrong order, then the final state is the same.
- **AC4** Given the consumer is down, then events are held and applied when it returns.
- **AC5** Given the broker is down when a claim is notified, then the claim is accepted and the event is delivered after the broker returns.

Tests: `tests/events/events.test.ts`, `tests/resilience/`, Newman step 15.

## US-7 Migrate legacy policies
**As a** data owner **I want** legacy v1 policies migrated to v2 **so that** the old system can be retired.

- **AC1** Every legacy row is either migrated or quarantined with a reason (migrated + rejected = legacy).
- **AC2** Total premium and insured value match between legacy and v2, and a hash of normalised records matches.
- **AC3** Every migrated field matches (status, values, insurers and shares).
- **AC4** Bad rows (duplicate policy number, shares not 100%, non-positive premium) are quarantined, not silently dropped.

Tests: `tests/migration/`.
