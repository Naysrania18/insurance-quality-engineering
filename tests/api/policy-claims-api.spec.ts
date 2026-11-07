import Ajv from 'ajv';
import { expect, test } from '@playwright/test';
import { Journey, call } from '../support/client.js';
import { serviceUrls } from '../support/fixtures.js';

const { policy: policyUrl, claims: claimsUrl } = serviceUrls;
const journey = new Journey(serviceUrls);
const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);

const policySchema = {
  type: 'object',
  required: ['id', 'policyRef', 'status', 'sumInsuredCents', 'totalPremiumCents', 'shares'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    policyRef: { type: 'string', pattern: '^POL-' },
    status: { enum: ['BOUND', 'CANCELLED'] },
    sumInsuredCents: { type: 'integer' },
    totalPremiumCents: { type: 'integer' },
    shares: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['insurer', 'bps', 'amountCents'],
        properties: {
          insurer: { type: 'string' },
          bps: { type: 'integer' },
          amountCents: { type: 'integer' },
        },
      },
    },
  },
};

test.describe('policy-service: binding', () => {
  test('binds a quote and returns a schema-valid policy @smoke @regression', async () => {
    const { policy, quote } = await journey.boundPolicy();
    const ajv = new Ajv({ formats: { uuid: true } });
    expect(ajv.validate(policySchema, policy), JSON.stringify(ajv.errors)).toBe(true);
    expect(policy.totalPremiumCents).toBe(quote.premiumCents);
    expect(policy.status).toBe('BOUND');
  });

  test('default panel shares total 100% (10000 bps) @regression', async () => {
    const { policy } = await journey.boundPolicy();
    expect(policy.shares.reduce((s: number, x: any) => s + x.bps, 0)).toBe(10_000);
  });

  test('accepts a custom two-insurer panel @regression', async () => {
    const risk = await journey.submitRisk();
    const quote = await journey.quote(risk.body.id);
    const res = await journey.bind(quote.body.id, [
      { insurer: 'Lead Insurer', bps: 7000 },
      { insurer: 'Follow Insurer', bps: 3000 },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.shares.map((s: any) => s.insurer).sort()).toEqual([
      'Follow Insurer',
      'Lead Insurer',
    ]);
  });

  const badPanels: [string, { insurer: string; bps: number }[]][] = [
    [
      'shares total 99.99%',
      [
        { insurer: 'A', bps: 5000 },
        { insurer: 'B', bps: 4999 },
      ],
    ],
    [
      'shares total over 100%',
      [
        { insurer: 'A', bps: 6000 },
        { insurer: 'B', bps: 5000 },
      ],
    ],
    [
      'duplicate insurer',
      [
        { insurer: 'A', bps: 5000 },
        { insurer: 'A', bps: 5000 },
      ],
    ],
    [
      'zero share',
      [
        { insurer: 'A', bps: 0 },
        { insurer: 'B', bps: 10_000 },
      ],
    ],
  ];
  for (const [name, panel] of badPanels) {
    test(`rejects a panel with ${name} @regression`, async () => {
      const risk = await journey.submitRisk();
      const quote = await journey.quote(risk.body.id);
      const res = await journey.bind(quote.body.id, panel);
      expect(res.status).toBe(400);
      // a rejected bind must leave the quote bindable
      expect((await journey.bind(quote.body.id)).status).toBe(201);
    });
  }

  test('cannot bind the same quote twice (409) @regression', async () => {
    const { quote } = await journey.boundPolicy();
    const again = await journey.bind(quote.id);
    expect(again.status).toBe(409);
  });

  test('concurrent binds of one quote create exactly one policy @regression', async () => {
    const risk = await journey.submitRisk();
    const quote = await journey.quote(risk.body.id);
    const results = await Promise.all(Array.from({ length: 4 }, () => journey.bind(quote.body.id)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });

  test('returns 404 for an unknown quote and 400 for a bad id @regression', async () => {
    expect((await journey.bind('33333333-3333-4333-8333-333333333333')).status).toBe(404);
    expect((await call(`${policyUrl}/policies`, 'POST', { quoteId: 'nope' })).status).toBe(400);
  });

  // KNOWN DEFECT DEF-001 (docs/defects/DEF-001-share-rounding.md)
  test('DEF-001: insurer shares add up to the premium @regression', async () => {
    test.fail(true, 'DEF-001: share rounding. See docs/defects/DEF-001-share-rounding.md');
    const { policy } = await journey.boundPolicy((b) => b.worth(1_000_070)); // premium 8001 cents
    expect(policy.totalPremiumCents).toBe(8001);
    expect(sum(policy.shares)).toBe(policy.totalPremiumCents);
  });
});

test.describe('claims-service: lifecycle', () => {
  test('notify -> assess -> settle happy path @smoke @regression', async () => {
    const { policy } = await journey.boundPolicy();
    const notified = await journey.notifyClaim(policy.id, (c) => c.forAmount(10_000_00));
    expect(notified.status).toBe(201);
    expect(notified.body).toMatchObject({ status: 'NOTIFIED', amountClaimedCents: 10_000_00 });

    const assessed = await journey.assess(notified.body.id, 8_000_00);
    expect(assessed.body).toMatchObject({ status: 'ASSESSED', assessedCents: 8_000_00 });

    const settled = await journey.settle(notified.body.id, 8_000_00);
    expect(settled.body).toMatchObject({ status: 'SETTLED', settledCents: 8_000_00 });
  });

  test('rejects a claim for an unknown policy (404) @regression', async () => {
    const res = await journey.notifyClaim('44444444-4444-4444-8444-444444444444');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('policy_not_found');
  });

  test('rejects a claim above the sum insured (422) @regression', async () => {
    const { policy } = await journey.boundPolicy((b) => b.worth(20_000_00));
    const res = await journey.notifyClaim(policy.id, (c) => c.forAmount(20_000_01));
    expect(res.status).toBe(422);
  });

  test('accepts a claim exactly equal to the sum insured @regression', async () => {
    const { policy } = await journey.boundPolicy((b) => b.worth(20_000_00));
    expect((await journey.notifyClaim(policy.id, (c) => c.forAmount(20_000_00))).status).toBe(201);
  });

  test('rejects a future loss date and invalid amounts (400) @regression', async () => {
    const { policy } = await journey.boundPolicy();
    expect((await journey.notifyClaim(policy.id, (c) => c.lostOn('2999-01-01'))).status).toBe(400);
    expect((await journey.notifyClaim(policy.id, (c) => c.forAmount(0))).status).toBe(400);
    expect((await journey.notifyClaim(policy.id, (c) => c.lostOn('15/01/2026'))).status).toBe(400);
  });

  test('enforces the state machine (409 on illegal transitions) @regression', async () => {
    const { policy } = await journey.boundPolicy();
    const claim = (await journey.notifyClaim(policy.id)).body;
    const earlySettle = await journey.settle(claim.id, 100);
    expect(earlySettle.status).toBe(409);
    await journey.assess(claim.id, 5_000_00);
    expect((await journey.assess(claim.id, 5_000_00)).status).toBe(409); // already assessed
    await journey.settle(claim.id, 5_000_00);
    expect((await journey.settle(claim.id, 5_000_00)).status).toBe(409); // already settled
  });

  test('rejects assessment above claim and settlement above assessment (422) @regression', async () => {
    const { policy } = await journey.boundPolicy();
    const claim = (await journey.notifyClaim(policy.id, (c) => c.forAmount(1_000_00))).body;
    expect((await journey.assess(claim.id, 1_000_01)).status).toBe(422);
    await journey.assess(claim.id, 900_00);
    expect((await journey.settle(claim.id, 900_01)).status).toBe(422);
  });

  test('returns 404 for an unknown claim @regression', async () => {
    expect((await call(`${claimsUrl}/claims/55555555-5555-4555-8555-555555555555`)).status).toBe(
      404,
    );
  });

  // KNOWN DEFECT DEF-002 (docs/defects/DEF-002-duplicate-claims.md)
  test('DEF-002: rejects a duplicate claim (same policy, loss date, amount) @regression', async () => {
    test.fail(
      true,
      'DEF-002: no duplicate-claim check. See docs/defects/DEF-002-duplicate-claims.md',
    );
    const { policy } = await journey.boundPolicy();
    expect((await journey.notifyClaim(policy.id)).status).toBe(201);
    expect((await journey.notifyClaim(policy.id)).status).toBe(409);
  });
});
