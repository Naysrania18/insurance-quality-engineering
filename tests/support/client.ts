import type { RiskType } from '../../shared/src/pricing.js';

export interface Urls {
  quote: string;
  policy: string;
  claims: string;
}

export async function call<T = any>(
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}

/** Test data builder: sensible valid defaults, override only what the test cares about. */
export class RiskBuilder {
  private data = {
    brokerId: '',
    riskType: 'marine_cargo' as RiskType,
    insuredValueCents: 250_000_00,
    description: 'Containerised electronics, Rotterdam to Singapore',
  };
  withBroker(id: string) {
    this.data.brokerId = id;
    return this;
  }
  ofType(t: RiskType) {
    this.data.riskType = t;
    return this;
  }
  worth(cents: number) {
    this.data.insuredValueCents = cents;
    return this;
  }
  described(d: string) {
    this.data.description = d;
    return this;
  }
  build() {
    return { ...this.data };
  }
}

export class ClaimBuilder {
  private data = {
    policyId: '',
    lossDate: '2026-01-15',
    amountClaimedCents: 10_000_00,
    description: 'Water damage to part of the consignment',
  };
  forPolicy(id: string) {
    this.data.policyId = id;
    return this;
  }
  lostOn(d: string) {
    this.data.lossDate = d;
    return this;
  }
  forAmount(c: number) {
    this.data.amountClaimedCents = c;
    return this;
  }
  build() {
    return { ...this.data };
  }
}

export class Journey {
  constructor(private u: Urls) {}

  async broker(): Promise<string> {
    const { body } = await call<any[]>(`${this.u.quote}/brokers`);
    return body[0].id;
  }
  async submitRisk(overrides: (b: RiskBuilder) => RiskBuilder = (b) => b) {
    const brokerId = await this.broker();
    return call(
      `${this.u.quote}/risks`,
      'POST',
      overrides(new RiskBuilder().withBroker(brokerId)).build(),
    );
  }
  async quote(riskId: string) {
    return call(`${this.u.quote}/risks/${riskId}/quote`, 'POST');
  }
  async bind(quoteId: string, panel?: { insurer: string; bps: number }[]) {
    return call(`${this.u.policy}/policies`, 'POST', { quoteId, panel });
  }
  /** submit -> quote -> bind; returns ids. */
  async boundPolicy(overrides: (b: RiskBuilder) => RiskBuilder = (b) => b) {
    const risk = await this.submitRisk(overrides);
    const quote = await this.quote(risk.body.id);
    const policy = await this.bind(quote.body.id);
    if (policy.status !== 201) throw new Error(`bind failed: ${JSON.stringify(policy.body)}`);
    return { risk: risk.body, quote: quote.body, policy: policy.body };
  }
  async notifyClaim(policyId: string, overrides: (b: ClaimBuilder) => ClaimBuilder = (b) => b) {
    return call(
      `${this.u.claims}/claims`,
      'POST',
      overrides(new ClaimBuilder().forPolicy(policyId)).build(),
    );
  }
  async assess(claimId: string, assessedCents: number) {
    return call(`${this.u.claims}/claims/${claimId}/assess`, 'POST', { assessedCents });
  }
  async settle(claimId: string, settledCents: number) {
    return call(`${this.u.claims}/claims/${claimId}/settle`, 'POST', { settledCents });
  }
}

/** Poll until `check` returns a truthy value (eventual consistency without fixed sleeps). */
export async function waitFor<T>(
  check: () => Promise<T | undefined | false | null>,
  { timeoutMs = 10_000, intervalMs = 100, label = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await check();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label}${last ? `: ${String(last)}` : ''}`,
  );
}
