import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import path from 'node:path';
import { MatchersV3, PactV4, Verifier } from '@pact-foundation/pact';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema, pgliteDb, type Db } from '../../shared/src/db.js';
import { createPolicyApp } from '../../services/policy-service/src/app.js';
import { HttpPolicyClient } from '../../services/claims-service/src/policy-client.js';

/**
 * Consumer-driven contract: claims-service (consumer) needs GET /policies/:id from policy-service (provider)
 * to return { id, policyRef, status, sumInsuredCents }. The consumer test writes the pact file; the
 * provider test replays it against the real policy-service app.
 */
const PACT_DIR = path.resolve('pacts');
const POLICY_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const { like, string, integer, regex } = MatchersV3;

describe('consumer: claims-service -> policy-service', () => {
  const pact = new PactV4({
    consumer: 'claims-service',
    provider: 'policy-service',
    dir: PACT_DIR,
    logLevel: 'warn',
  });

  it('gets a bound policy by id', async () => {
    await pact
      .addInteraction()
      .given('a BOUND policy exists')
      .uponReceiving('a request for an existing policy')
      .withRequest('GET', `/policies/${POLICY_ID}`, (b) => b.headers({ Accept: 'application/json' }))
      .willRespondWith(200, (b) =>
        b.headers({ 'Content-Type': regex(/application\/json/, 'application/json; charset=utf-8') }).jsonBody({
          id: string(POLICY_ID),
          policyRef: string('POL-ABC12345'),
          status: string('BOUND'),
          sumInsuredCents: integer(250_000_00),
        }),
      )
      .executeTest(async (mock) => {
        const policy = await new HttpPolicyClient(mock.url).getPolicy(POLICY_ID);
        expect(policy).toMatchObject({ id: POLICY_ID, status: 'BOUND' });
        expect(typeof policy?.sumInsuredCents).toBe('number');
      });
  });

  it('gets null for an unknown policy (404)', async () => {
    await pact
      .addInteraction()
      .given('no policy exists')
      .uponReceiving('a request for a policy that does not exist')
      .withRequest('GET', `/policies/${MISSING_ID}`, (b) => b.headers({ Accept: 'application/json' }))
      .willRespondWith(404, (b) =>
        b
          .headers({ 'Content-Type': regex(/application\/json/, 'application/json; charset=utf-8') })
          .jsonBody({ error: like({ code: 'policy_not_found', message: 'Policy not found' }) }),
      )
      .executeTest(async (mock) => {
        expect(await new HttpPolicyClient(mock.url).getPolicy(MISSING_ID)).toBeNull();
      });
  });
});

describe('provider: policy-service honours the pact', () => {
  let db: Db;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    db = await pgliteDb();
    await applySchema(db);
    server = await new Promise<Server>((resolve) => {
      const s = createPolicyApp(db).listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    await db.close();
  });

  it('verifies the claims-service pact', async () => {
    const verifier = new Verifier({
      provider: 'policy-service',
      providerBaseUrl: baseUrl,
      pactUrls: [path.join(PACT_DIR, 'claims-service-policy-service.json')],
      logLevel: 'warn',
      stateHandlers: {
        'a BOUND policy exists': async () => {
          const brokerId = randomUUID();
          const riskId = randomUUID();
          const quoteId = randomUUID();
          await db.query('DELETE FROM policies WHERE id = $1', [POLICY_ID]);
          await db.query(`INSERT INTO brokers (id, name, email) VALUES ($1,'Pact Broker',$2)`, [brokerId, `${brokerId}@example.test`]);
          await db.query(
            `INSERT INTO risks (id, broker_id, risk_type, insured_value_cents, description, status)
             VALUES ($1,$2,'marine_cargo',25000000,'pact','BOUND')`,
            [riskId, brokerId],
          );
          await db.query(`INSERT INTO quotes (id, risk_id, premium_cents, status) VALUES ($1,$2,200000,'ACCEPTED')`, [quoteId, riskId]);
          await db.query(
            `INSERT INTO policies (id, policy_ref, quote_id, status, sum_insured_cents, total_premium_cents)
             VALUES ($1,'POL-PACT0001',$2,'BOUND',25000000,200000)`,
            [POLICY_ID, quoteId],
          );
        },
        'no policy exists': async () => {
          await db.query('DELETE FROM insurer_shares');
          await db.query('DELETE FROM premiums');
          await db.query('DELETE FROM policies');
        },
      },
    });
    await verifier.verifyProvider();
  });
});
