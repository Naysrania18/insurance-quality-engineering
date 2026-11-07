import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newEvent, type DomainEvent } from '../../shared/src/events.js';
import { policyClaimHandler } from '../../services/policy-service/src/consumers.js';
import { enqueueEvent, startOutboxRelay } from '../../shared/src/outbox.js';
import { Journey, waitFor } from '../support/client.js';
import { useIsolatedEventEnv, useTarget, type Target } from '../support/stack.js';

/**
 * Handler-level event tests. They run against an isolated database; the bus is in-memory by default and
 * real RabbitMQ when RABBITMQ_URL is set (CI), so the same assertions cover both implementations.
 */
describe('claim events -> policy projection', () => {
  let env: Awaited<ReturnType<typeof useIsolatedEventEnv>>;
  let policyId: string;
  let consumer: string;

  const claimNotified = (claimId: string) =>
    newEvent('ClaimNotified', { claimId, policyId, amountClaimedCents: 1000 });
  const claimSettled = (claimId: string, settledCents: number) =>
    newEvent('ClaimSettled', { claimId, policyId, settledCents });

  const policyRow = async () =>
    (
      await env.db.query('SELECT open_claims, claims_paid_cents FROM policies WHERE id = $1', [
        policyId,
      ])
    ).rows[0] as { open_claims: number; claims_paid_cents: string };
  const state = async () => {
    const p = await policyRow();
    return { open: Number(p.open_claims), paid: Number(p.claims_paid_cents) };
  };

  beforeAll(async () => {
    env = await useIsolatedEventEnv();
  });
  afterAll(async () => {
    await env.stop();
  });

  beforeEach(async () => {
    policyId = randomUUID();
    consumer = `test.policy.${randomUUID()}`;
    const brokerId = randomUUID();
    const riskId = randomUUID();
    const quoteId = randomUUID();
    await env.db.query(`INSERT INTO brokers (id, name, email) VALUES ($1,'B',$2)`, [
      brokerId,
      `${brokerId}@example.test`,
    ]);
    await env.db.query(
      `INSERT INTO risks (id, broker_id, risk_type, insured_value_cents, description, status)
       VALUES ($1,$2,'marine_cargo',10000000,'x','BOUND')`,
      [riskId, brokerId],
    );
    await env.db.query(
      `INSERT INTO quotes (id, risk_id, premium_cents, status) VALUES ($1,$2,80000,'ACCEPTED')`,
      [quoteId, riskId],
    );
    await env.db.query(
      `INSERT INTO policies (id, policy_ref, quote_id, status, sum_insured_cents, total_premium_cents)
       VALUES ($1,$2,$3,'BOUND',10000000,80000)`,
      [policyId, `POL-${policyId.slice(0, 8)}`, quoteId],
    );
  });

  const subscribe = (c = consumer) =>
    env.bus.subscribe(c, ['ClaimNotified', 'ClaimSettled'], policyClaimHandler(env.db, c));

  it('publishes an event and the consumer applies it', async () => {
    const sub = await subscribe();
    const claimId = randomUUID();
    await env.bus.publish(claimNotified(claimId));
    await waitFor(async () => (await state()).open === 1, { label: 'open_claims = 1' });
    await env.bus.publish(claimSettled(claimId, 700));
    await waitFor(async () => (await state()).paid === 700, { label: 'claims_paid = 700' });
    expect(await state()).toEqual({ open: 0, paid: 700 });
    await sub.stop();
  });

  it('is idempotent: the same event delivered twice is applied once', async () => {
    const sub = await subscribe();
    const claimId = randomUUID();
    const evt = claimSettled(claimId, 500);
    await env.bus.publish(claimNotified(claimId));
    await env.bus.publish(evt);
    await env.bus.publish(evt); // duplicate delivery (same eventId)
    await waitFor(async () => (await state()).paid === 500, { label: 'paid applied' });
    // let the duplicate settle before asserting nothing changed
    await new Promise((r) => setTimeout(r, 300));
    expect((await state()).paid).toBe(500);
    const seen = await env.db.query(
      'SELECT COUNT(*)::int AS n FROM processed_events WHERE consumer = $1 AND event_id = $2',
      [consumer, evt.eventId],
    );
    expect(seen.rows[0].n).toBe(1);
    await sub.stop();
  });

  it('tolerates out-of-order delivery (ClaimSettled before ClaimNotified)', async () => {
    const sub = await subscribe();
    const claimId = randomUUID();
    await env.bus.publish(claimSettled(claimId, 900));
    await env.bus.publish(claimNotified(claimId));
    await waitFor(async () => (await state()).paid === 900, { label: 'paid applied' });
    await new Promise((r) => setTimeout(r, 200));
    // The claim must not be left "open" just because the notification arrived last.
    expect(await state()).toEqual({ open: 0, paid: 900 });
    await sub.stop();
  });

  it('buffers events while the consumer is down and catches up on recovery', async () => {
    const first = await subscribe(); // creates the durable queue
    await first.stop(); // consumer goes down
    const claimId = randomUUID();
    await env.bus.publish(claimNotified(claimId));
    await env.bus.publish(claimSettled(claimId, 300));
    await new Promise((r) => setTimeout(r, 300));
    expect(await state()).toEqual({ open: 0, paid: 0 }); // nothing processed while down

    const second = await subscribe(); // consumer recovers
    await waitFor(async () => (await state()).paid === 300, { label: 'catch-up after recovery' });
    expect(await state()).toEqual({ open: 0, paid: 300 });
    await second.stop();
  });

  it('dead-letters a poison message and keeps processing valid ones', async () => {
    const sub = await subscribe();
    const poison: DomainEvent = newEvent('ClaimNotified', { claimId: randomUUID() }); // no policyId
    await env.bus.publish(poison);
    const claimId = randomUUID();
    await env.bus.publish(claimNotified(claimId));
    await waitFor(async () => (await state()).open === 1, { label: 'valid message processed' });
    await waitFor(async () => env.bus.deadLetters(consumer).length === 1, {
      label: 'dead letter recorded',
    });
    expect(env.bus.deadLetters(consumer)[0].eventId).toBe(poison.eventId);
    await sub.stop();
  });

  it('converges to the same state regardless of event order (property check)', async () => {
    const claimIds = [randomUUID(), randomUUID(), randomUUID()];
    const events = claimIds.flatMap((id, i) => [
      claimNotified(id),
      claimSettled(id, (i + 1) * 100),
    ]);
    // reverse order is the worst case: every settle precedes its notify
    const sub = await subscribe();
    for (const e of [...events].reverse()) await env.bus.publish(e);
    await waitFor(async () => (await state()).paid === 600, { label: 'paid = 600' });
    await new Promise((r) => setTimeout(r, 200));
    expect(await state()).toEqual({ open: 0, paid: 600 });
    await sub.stop();
  });
});

describe('transactional outbox', () => {
  let env: Awaited<ReturnType<typeof useIsolatedEventEnv>>;
  beforeAll(async () => {
    env = await useIsolatedEventEnv();
  });
  afterAll(async () => {
    await env.stop();
  });

  it('keeps events pending when the broker fails, then delivers after recovery (no lost events)', async () => {
    let up = false;
    const delivered: string[] = [];
    const flaky = {
      ...env.bus,
      publish: async (e: DomainEvent) => {
        if (!up) throw new Error('broker unavailable');
        delivered.push(e.eventId);
      },
    } as typeof env.bus;
    const evt = await env.db.tx((q) => enqueueEvent(q, 'PolicyBound', { policyId: randomUUID() }));
    const relay = startOutboxRelay(env.db, flaky, 50);

    await new Promise((r) => setTimeout(r, 250));
    expect(delivered).toEqual([]); // broker down: still pending
    const pending = await env.db.query(
      'SELECT COUNT(*)::int AS n FROM outbox WHERE published_at IS NULL',
    );
    expect(pending.rows[0].n).toBe(1);

    up = true; // broker recovers
    await waitFor(async () => delivered.length === 1, { label: 'event delivered after recovery' });
    expect(delivered).toEqual([evt.eventId]);
    relay.stop();
  });
});

describe('end-to-end event flow through the services (eventual consistency)', () => {
  let t: Target;
  beforeAll(async () => {
    t = await useTarget();
  });
  afterAll(async () => {
    await t.stop();
  });

  it('settling a claim eventually updates the policy within the timeout', async () => {
    const j = new Journey(t.urls);
    const { policy } = await j.boundPolicy();
    const claim = await j.notifyClaim(policy.id, (c) => c.forAmount(1_000_00));
    await j.assess(claim.body.id, 800_00);
    await j.settle(claim.body.id, 800_00);

    // Not asserted immediately: the projection is eventually consistent. Poll with a timeout.
    const updated = await waitFor(
      async () => {
        await t.flush();
        const r = await fetch(`${t.urls.policy}/policies/${policy.id}`);
        const p = (await r.json()) as any;
        return p.claimsPaidCents === 800_00 && p.openClaims === 0 ? p : undefined;
      },
      { timeoutMs: 15_000, label: 'policy projection to reflect settlement' },
    );
    expect(updated.claimsPaidCents).toBe(800_00);
  });

  it('PolicyBound is published when a policy is bound', async () => {
    const received: DomainEvent[] = [];
    const sub = await t.bus.subscribe(
      `test.observer.${randomUUID()}`,
      ['PolicyBound'],
      async (e) => {
        received.push(e);
      },
    );
    const { policy } = await new Journey(t.urls).boundPolicy();
    await waitFor(
      async () => {
        await t.flush();
        return received.some((e) => e.data.policyId === policy.id);
      },
      { label: 'PolicyBound event', timeoutMs: 15_000 },
    );
    const evt = received.find((e) => e.data.policyId === policy.id)!;
    expect(evt).toMatchObject({ type: 'PolicyBound', version: 1 });
    expect(evt.data.totalPremiumCents).toBe(policy.totalPremiumCents);
    await sub.stop();
  });
});
