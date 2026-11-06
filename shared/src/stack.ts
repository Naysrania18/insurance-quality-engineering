import type { Server } from 'node:http';
import type { Express } from 'express';
import type { Db } from './db.js';
import type { EventBus, Subscription } from './events.js';
import { startOutboxRelay, type Relay } from './outbox.js';
import { createQuoteApp } from '../../services/quote-service/src/app.js';
import { createPolicyApp } from '../../services/policy-service/src/app.js';
import { startPolicyConsumers } from '../../services/policy-service/src/consumers.js';
import { createClaimsApp } from '../../services/claims-service/src/app.js';
import { HttpPolicyClient } from '../../services/claims-service/src/policy-client.js';
import { createWebApp } from '../../web/server.js';

export interface Stack {
  urls: { web: string; quote: string; policy: string; claims: string };
  db: Db;
  bus: EventBus;
  /** Push any pending outbox rows to the bus now (tests use this instead of sleeping). */
  flushEvents(): Promise<void>;
  stop(): Promise<void>;
}

function listen(app: Express, port: number): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => resolve(server));
  });
}
const portOf = (s: Server) => (s.address() as { port: number }).port;

/** Start all four HTTP apps, the policy consumers and the outbox relay in one process. */
export async function startStack(
  db: Db,
  bus: EventBus,
  ports = { web: 0, quote: 0, policy: 0, claims: 0 },
): Promise<Stack> {
  const quote = await listen(createQuoteApp(db), ports.quote);
  const policy = await listen(createPolicyApp(db), ports.policy);
  const policyUrl = `http://127.0.0.1:${portOf(policy)}`;
  const claims = await listen(createClaimsApp(db, new HttpPolicyClient(policyUrl)), ports.claims);
  const quoteUrl = `http://127.0.0.1:${portOf(quote)}`;
  const claimsUrl = `http://127.0.0.1:${portOf(claims)}`;
  const web = await listen(createWebApp({ quoteUrl, policyUrl, claimsUrl }), ports.web);

  const sub: Subscription = await startPolicyConsumers(db, bus);
  const relay: Relay = startOutboxRelay(db, bus, 100);
  const servers = [web, quote, policy, claims];

  return {
    urls: { web: `http://127.0.0.1:${portOf(web)}`, quote: quoteUrl, policy: policyUrl, claims: claimsUrl },
    db,
    bus,
    flushEvents: async () => {
      await relay.flush();
    },
    stop: async () => {
      relay.stop();
      await sub.stop();
      await Promise.all(
        servers.map(
          (s) =>
            new Promise<void>((r) => {
              s.closeAllConnections();
              s.close(() => r());
            }),
        ),
      );
    },
  };
}
