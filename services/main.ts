/**
 * Container entrypoint: `SERVICE=quote|policy|claims tsx services/main.ts`.
 * Requires DATABASE_URL (Postgres); policy and claims also use RABBITMQ_URL.
 */
import { pgDb } from '../shared/src/db.js';
import { RabbitBus } from '../shared/src/events.js';
import { startOutboxRelay } from '../shared/src/outbox.js';
import { createQuoteApp } from './quote-service/src/app.js';
import { createPolicyApp } from './policy-service/src/app.js';
import { startPolicyConsumers } from './policy-service/src/consumers.js';
import { createClaimsApp } from './claims-service/src/app.js';
import { HttpPolicyClient } from './claims-service/src/policy-client.js';

const service = process.env.SERVICE;
const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const db = pgDb(databaseUrl);

async function main(): Promise<void> {
  let app;
  if (service === 'quote') {
    app = createQuoteApp(db);
  } else if (service === 'policy') {
    const bus = new RabbitBus(process.env.RABBITMQ_URL ?? 'amqp://localhost');
    app = createPolicyApp(db);
    startOutboxRelay(db, bus);
    await retry(() => startPolicyConsumers(db, bus));
  } else if (service === 'claims') {
    const bus = new RabbitBus(process.env.RABBITMQ_URL ?? 'amqp://localhost');
    app = createClaimsApp(
      db,
      new HttpPolicyClient(process.env.POLICY_SERVICE_URL ?? 'http://localhost:3002'),
    );
    startOutboxRelay(db, bus);
  } else {
    throw new Error(`Unknown SERVICE: ${service}`);
  }
  app.listen(port, '0.0.0.0', () => console.log(`${service}-service listening on ${port}`));
}

async function retry<T>(fn: () => Promise<T>, attempts = 30): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
