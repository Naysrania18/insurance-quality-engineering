import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Journey, waitFor } from '../support/client.js';
import { useTarget, type Target } from '../support/stack.js';
import { checks } from './checks.js';

let t: Target;
let j: Journey;

const offenders = async (sql: string) => (await t.db.query(sql)).rows;

beforeAll(async () => {
  t = await useTarget();
  j = new Journey(t.urls);

  // Build a realistic data set through the public APIs (on top of seed data).
  // 1_000_070 cents => 8001 cent premium, a value that exposes share rounding (DEF-001).
  const rounding = await j.boundPolicy((b) => b.worth(1_000_070));
  await j.boundPolicy((b) => b.ofType('commercial_property').worth(750_000_00));
  const big = await j.boundPolicy((b) => b.worth(3_000_000_00));

  // A claim taken all the way to settlement (exposes DEF-003) ...
  const claim = await j.notifyClaim(big.policy.id, (c) => c.forAmount(50_000_00));
  await j.assess(claim.body.id, 40_000_00);
  await j.settle(claim.body.id, 40_000_00);
  // ... and one left part-way.
  const open = await j.notifyClaim(rounding.policy.id, (c) =>
    c.forAmount(500_00).lostOn('2026-02-01'),
  );
  await j.assess(open.body.id, 400_00);
  await t.flush();
});

afterAll(async () => {
  await t.stop();
});

describe('premium and co-insurance integrity', () => {
  // KNOWN DEFECT DEF-001: docs/defects/DEF-001-share-rounding.md
  it.fails('DEF-001: premium equals the sum of insurer shares for every policy', async () => {
    expect(await offenders(checks.premiumEqualsSumOfShares)).toEqual([]);
  });

  // Positive control: proves the expected-failure test above fails for the RIGHT reason (real offenders,
  // not a broken query). Remove together with `.fails` when DEF-001 is fixed.
  it('control: the share-rounding offender query finds the 8001-cent policy', async () => {
    const rows = await offenders(checks.premiumEqualsSumOfShares);
    expect(rows.some((r: any) => Number(r.total_premium_cents) === 8001)).toBe(true);
  });

  it('insurer shares total exactly 100% on every policy', async () => {
    expect(await offenders(checks.sharesTotalOneHundredPercent)).toEqual([]);
  });

  it('every policy has at least one insurer share', async () => {
    expect(await offenders(checks.policiesWithoutShares)).toEqual([]);
  });

  it('premium row, quote premium and policy premium agree', async () => {
    expect(await offenders(checks.premiumRowMatchesPolicyAndQuote)).toEqual([]);
  });
});

describe('referential integrity', () => {
  it('has no orphan claims (every claim belongs to a bound policy)', async () => {
    expect(await offenders(checks.orphanClaims)).toEqual([]);
  });
});

describe('audit trail', () => {
  it('has a BOUND audit entry for every policy', async () => {
    expect(await offenders(checks.policiesMissingBoundAudit)).toEqual([]);
  });

  it('has an audit entry for the current state of every risk', async () => {
    expect(await offenders(checks.risksMissingAuditForCurrentState)).toEqual([]);
  });

  it('has audit entries for NOTIFIED and ASSESSED claim states', async () => {
    const rows = await offenders(checks.claimsMissingAuditForState);
    expect(rows.filter((r: any) => r.missing_state !== 'SETTLED')).toEqual([]);
  });

  it('control: the only missing audit states are SETTLED (DEF-003 is isolated)', async () => {
    const rows = await offenders(checks.claimsMissingAuditForState);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r: any) => r.missing_state))).toEqual(new Set(['SETTLED']));
  });

  // KNOWN DEFECT DEF-003: docs/defects/DEF-003-missing-settlement-audit.md
  it.fails(
    'DEF-003: has an audit entry for every state a claim has passed through (incl. SETTLED)',
    async () => {
      expect(await offenders(checks.claimsMissingAuditForState)).toEqual([]);
    },
  );
});

describe('duplicates', () => {
  it('has no duplicate policy for a quote', async () => {
    expect(await offenders(checks.duplicatePolicyPerQuote)).toEqual([]);
  });

  it('has no duplicate insurer on a policy', async () => {
    expect(await offenders(checks.duplicateInsurerOnPolicy)).toEqual([]);
  });

  it('has no duplicate outbox events', async () => {
    expect(await offenders(checks.duplicateOutboxEvents)).toEqual([]);
  });

  // KNOWN DEFECT DEF-002: docs/defects/DEF-002-duplicate-claims.md
  it.fails('DEF-002: has no duplicate claims (same policy, loss date and amount)', async () => {
    const { policy } = await j.boundPolicy();
    const first = await j.notifyClaim(policy.id);
    const second = await j.notifyClaim(policy.id);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409); // fails today: 201, so a duplicate row exists
    expect(await offenders(checks.duplicateClaims)).toEqual([]);
  });
});

describe('eventual consistency between services', () => {
  it('policy claims_paid converges to the sum of settled claims', async () => {
    await waitFor(
      async () => {
        await t.flush();
        return (await offenders(checks.policyClaimsPaidMatchesSettledClaims)).length === 0;
      },
      { label: 'claims_paid projection to converge', timeoutMs: 15_000 },
    );
    expect(await offenders(checks.policyClaimsPaidMatchesSettledClaims)).toEqual([]);
  });
});
