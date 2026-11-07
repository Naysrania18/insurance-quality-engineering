import { expect, test } from '@playwright/test';
import { RiskBuilder, call } from '../support/client.js';
import { serviceUrls } from '../support/fixtures.js';

const quote = serviceUrls.quote;
let brokerId: string;

test.beforeAll(async () => {
  const brokers = await call<any[]>(`${quote}/brokers`);
  brokerId = brokers.body[0].id;
});

test.describe('quote-service: risks', () => {
  test('GET /health responds ok @smoke', async ({ request }) => {
    const res = await request.get(`${quote}/health`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ service: 'quote-service', status: 'ok' });
  });

  test('submits a valid risk @smoke @regression', async ({ request }) => {
    const res = await request.post(`${quote}/risks`, {
      data: new RiskBuilder().withBroker(brokerId).build(),
    });
    expect(res.status()).toBe(201);
    const risk = await res.json();
    expect(risk).toMatchObject({ status: 'SUBMITTED', riskType: 'marine_cargo', currency: 'USD' });
    expect(risk.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  const invalid: [string, (b: RiskBuilder) => RiskBuilder, number][] = [
    ['value below minimum appetite', (b) => b.worth(999_999), 400],
    ['value above maximum appetite', (b) => b.worth(5_000_000_001), 400],
    ['negative value', (b) => b.worth(-1), 400],
    ['fractional cents', (b) => b.worth(1_000_000.5), 400],
    ['unknown risk type', (b) => b.ofType('cyber' as never), 400],
    ['empty description', (b) => b.described(''), 400],
    ['over-long description', (b) => b.described('x'.repeat(501)), 400],
  ];
  for (const [name, mutate, status] of invalid) {
    test(`rejects ${name} @regression`, async ({ request }) => {
      const res = await request.post(`${quote}/risks`, {
        data: mutate(new RiskBuilder().withBroker(brokerId)).build(),
      });
      expect(res.status()).toBe(status);
      expect((await res.json()).error.code).toBe('validation_error');
    });
  }

  test('rejects an unknown broker with 404 @regression', async ({ request }) => {
    const res = await request.post(`${quote}/risks`, {
      data: new RiskBuilder().withBroker('11111111-1111-4111-8111-111111111111').build(),
    });
    expect(res.status()).toBe(404);
  });

  test('rejects malformed JSON with 400 and no stack trace @regression', async ({ request }) => {
    const res = await request.post(`${quote}/risks`, {
      headers: { 'Content-Type': 'application/json' },
      data: '{ not json',
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).not.toMatch(/at .*\(.*:\d+:\d+\)/);
  });

  test('returns 400 for a non-UUID id and 404 for an unknown id @regression', async ({
    request,
  }) => {
    expect((await request.get(`${quote}/risks/not-a-uuid`)).status()).toBe(400);
    expect(
      (await request.get(`${quote}/risks/22222222-2222-4222-8222-222222222222`)).status(),
    ).toBe(404);
  });

  test('is not vulnerable to SQL injection in query parameters @regression', async ({
    request,
  }) => {
    const res = await request.get(`${quote}/risks`, { params: { status: "SUBMITTED' OR '1'='1" } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([]); // parameterised: treated as a literal, matches nothing
  });
});

test.describe('quote-service: quoting', () => {
  test('quotes a marine risk at 0.80% @smoke @regression', async ({ request }) => {
    const risk = await (
      await request.post(`${quote}/risks`, {
        data: new RiskBuilder().withBroker(brokerId).worth(500_000_00).build(),
      })
    ).json();
    const res = await request.post(`${quote}/risks/${risk.id}/quote`);
    expect(res.status()).toBe(201);
    const q = await res.json();
    expect(q).toMatchObject({ riskId: risk.id, status: 'QUOTED', premiumCents: 4_000_00 });
    expect((await (await request.get(`${quote}/risks/${risk.id}`)).json()).status).toBe('QUOTED');
  });

  test('quotes a property risk at 1.20% @regression', async ({ request }) => {
    const risk = await (
      await request.post(`${quote}/risks`, {
        data: new RiskBuilder()
          .withBroker(brokerId)
          .ofType('commercial_property')
          .worth(500_000_00)
          .build(),
      })
    ).json();
    const q = await (await request.post(`${quote}/risks/${risk.id}/quote`)).json();
    expect(q.premiumCents).toBe(6_000_00);
  });

  test('applies the large-risk loading above 1,000,000 @regression', async ({ request }) => {
    const risk = await (
      await request.post(`${quote}/risks`, {
        data: new RiskBuilder().withBroker(brokerId).worth(2_000_000_00).build(),
      })
    ).json();
    const q = await (await request.post(`${quote}/risks/${risk.id}/quote`)).json();
    expect(q.premiumCents).toBe(17_600_00); // 2,000,000 x 0.8% x 1.10
  });

  // KNOWN DEFECT DEF-004 (docs/planted-defects.md): exactly 1,000,000.00 should be loaded.
  test('DEF-004: loads a risk of exactly 1,000,000.00 @regression', async ({ request }) => {
    test.fail(true, 'DEF-004: threshold uses > instead of >=. See docs/planted-defects.md');
    const risk = await (
      await request.post(`${quote}/risks`, {
        data: new RiskBuilder().withBroker(brokerId).worth(1_000_000_00).build(),
      })
    ).json();
    const q = await (await request.post(`${quote}/risks/${risk.id}/quote`)).json();
    expect(q.premiumCents).toBe(8_800_00);
  });

  test('cannot quote the same risk twice (409) @regression', async ({ request }) => {
    const risk = await (
      await request.post(`${quote}/risks`, { data: new RiskBuilder().withBroker(brokerId).build() })
    ).json();
    expect((await request.post(`${quote}/risks/${risk.id}/quote`)).status()).toBe(201);
    const again = await request.post(`${quote}/risks/${risk.id}/quote`);
    expect(again.status()).toBe(409);
    expect((await again.json()).error.code).toBe('risk_not_quotable');
  });

  test('concurrent quote requests produce exactly one quote @regression', async ({ request }) => {
    const risk = await (
      await request.post(`${quote}/risks`, { data: new RiskBuilder().withBroker(brokerId).build() })
    ).json();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => request.post(`${quote}/risks/${risk.id}/quote`)),
    );
    expect(results.filter((r) => r.status() === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status() === 409)).toHaveLength(4);
  });

  test('sends security headers on API responses @regression', async ({ request }) => {
    const res = await request.get(`${quote}/risks`);
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['x-powered-by']).toBeUndefined();
  });
});
