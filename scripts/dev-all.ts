/**
 * Run the whole platform in ONE process with no Docker: in-process Postgres (PGlite) and an
 * in-memory event bus. Used for local development and by Playwright when BASE_URL is not set.
 * Ports: web 3000, quote 3001, policy 3002, claims 3003.
 */
import { applySchema, pgliteDb } from '../shared/src/db.js';
import { InMemoryBus } from '../shared/src/events.js';
import { startStack } from '../shared/src/stack.js';
import { seedDatabase } from '../db/seed/seed.js';

const db = await pgliteDb();
await applySchema(db);
await seedDatabase(db);
const stack = await startStack(db, new InMemoryBus(), {
  web: Number(process.env.WEB_PORT ?? 3000),
  quote: 3001,
  policy: 3002,
  claims: 3003,
});
console.log('Platform ready:', stack.urls);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => void stack.stop().then(() => process.exit(0)));
}
