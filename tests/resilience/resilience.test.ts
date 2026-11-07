import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Journey, call, waitFor } from '../support/client.js';
import { useTarget, type Target } from '../support/stack.js';

/**
 * Resilience tests with Toxiproxy (https://github.com/Shopify/toxiproxy).
 * They need the compose stack started with the "resilience" profile and claims-service pointed at the
 * proxies (see docker-compose.yml and .github/workflows/ci.yml). Without TOXIPROXY_URL they are skipped.
 *
 *   policy proxy   :8666  claims-service -> policy-service (HTTP)
 *   rabbit proxy   :8667  claims-service -> RabbitMQ (AMQP)
 *   postgres proxy :8668  claims-service -> PostgreSQL
 */
const TOXI = process.env.TOXIPROXY_URL;
const run = TOXI ? describe : describe.skip;

const toxi = (path: string, method = 'GET', body?: unknown) => call(`${TOXI}${path}`, method, body);
const setEnabled = (proxy: string, enabled: boolean) =>
  toxi(`/proxies/${proxy}`, 'POST', { enabled });
const addToxic = (proxy: string, name: string, type: string, attributes: Record<string, unknown>) =>
  toxi(`/proxies/${proxy}/toxics`, 'POST', {
    name,
    type,
    stream: 'downstream',
    toxicity: 1,
    attributes,
  });
const removeToxic = (proxy: string, name: string) =>
  toxi(`/proxies/${proxy}/toxics/${name}`, 'DELETE');

run('claims-service under network faults', () => {
  let t: Target;
  let j: Journey;
  let policyId: string;

  beforeAll(async () => {
    t = await useTarget();
    j = new Journey(t.urls);
    policyId = (await j.boundPolicy()).policy.id; // policy-service itself is reached directly
  });

  afterEach(async () => {
    // Always heal the network so one failing test cannot poison the next.
    for (const p of ['policy', 'rabbit', 'postgres']) {
      await setEnabled(p, true);
    }
    await removeToxic('policy', 'slow').catch(() => undefined);
    await removeToxic('postgres', 'slow').catch(() => undefined);
  });

  afterAll(async () => {
    await t.stop();
  });

  it('fails fast with 503 (not a hang) when policy-service is slow, then recovers', async () => {
    await addToxic('policy', 'slow', 'latency', { latency: 6000 });
    const started = Date.now();
    const res = await j.notifyClaim(policyId, (c) => c.lostOn('2026-03-01'));
    const elapsed = Date.now() - started;

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('policy_service_unavailable');
    expect(elapsed).toBeLessThan(4000); // client timeout (1.5s) bounds the wait, not the 6s latency
    const stored = await t.db.query(
      `SELECT COUNT(*)::int AS n FROM claims WHERE loss_date = '2026-03-01' AND policy_id = $1`,
      [policyId],
    );
    expect(stored.rows[0].n).toBe(0); // no half-created claim

    await removeToxic('policy', 'slow');
    const ok = await j.notifyClaim(policyId, (c) => c.lostOn('2026-03-01'));
    expect(ok.status).toBe(201);
  });

  it('returns 503 when policy-service is unreachable, while reads keep working (graceful degradation)', async () => {
    await setEnabled('policy', false);
    const res = await j.notifyClaim(policyId, (c) => c.lostOn('2026-03-02'));
    expect(res.status).toBe(503);
    const list = await call(`${t.urls.claims}/claims?policyId=${policyId}`);
    expect(list.status).toBe(200); // reading claims does not depend on policy-service
  });

  it('accepts claims while the broker is down and delivers the event after recovery (no lost events)', async () => {
    await setEnabled('rabbit', false);
    const res = await j.notifyClaim(policyId, (c) => c.lostOn('2026-03-03').forAmount(12_345_00));
    expect(res.status).toBe(201); // business write succeeds; the event waits in the outbox

    const pending = await t.db.query(
      `SELECT COUNT(*)::int AS n FROM outbox WHERE published_at IS NULL AND payload LIKE $1`,
      [`%${res.body.id}%`],
    );
    expect(pending.rows[0].n).toBe(1);

    await setEnabled('rabbit', true);
    await waitFor(
      async () => {
        const r = await t.db.query(`SELECT published_at FROM outbox WHERE payload LIKE $1`, [
          `%${res.body.id}%`,
        ]);
        return r.rows[0]?.published_at ? true : undefined;
      },
      { timeoutMs: 30_000, label: 'outbox event published after broker recovery' },
    );
    // and the policy projection (consumer side) catches up
    await waitFor(
      async () => {
        const p = (await call<any>(`${t.urls.policy}/policies/${policyId}`)).body;
        return p.openClaims >= 1 ? true : undefined;
      },
      { timeoutMs: 30_000, label: 'policy open_claims updated' },
    );
  });

  it('returns a clean 5xx (no stack trace) when the database is unreachable, then recovers', async () => {
    await setEnabled('postgres', false);
    const res = await call(`${t.urls.claims}/claims?policyId=${policyId}`);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\(.*:\d+:\d+\)|node_modules/);

    await setEnabled('postgres', true);
    await waitFor(
      async () => (await call(`${t.urls.claims}/claims?policyId=${policyId}`)).status === 200,
      {
        timeoutMs: 20_000,
        label: 'claims-service to reconnect to the database',
      },
    );
  });

  it('tolerates database latency without corrupting data', async () => {
    await addToxic('postgres', 'slow', 'latency', { latency: 400 });
    const res = await j.notifyClaim(policyId, (c) => c.lostOn('2026-03-04').forAmount(777_00));
    expect(res.status).toBe(201);
    await removeToxic('postgres', 'slow');
    const row = await t.db.query(`SELECT status FROM claims WHERE id = $1`, [res.body.id]);
    expect(row.rows[0].status).toBe('NOTIFIED');
  });
});
