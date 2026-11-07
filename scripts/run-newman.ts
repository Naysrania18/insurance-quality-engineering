/**
 * Run the Postman collection with Newman and write an HTML report (reports/newman-report.html).
 * Targets the docker-compose stack if NEWMAN_EXTERNAL=1, otherwise starts the in-process stack.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import newman from 'newman';
import { applySchema, pgliteDb } from '../shared/src/db.js';
import { InMemoryBus } from '../shared/src/events.js';
import { startStack, type Stack } from '../shared/src/stack.js';
import { seedDatabase } from '../db/seed/seed.js';

mkdirSync('reports', { recursive: true });
const env = JSON.parse(readFileSync('tests/postman/local.postman_environment.json', 'utf8'));

let stack: Stack | undefined;
if (process.env.NEWMAN_EXTERNAL !== '1') {
  const db = await pgliteDb();
  await applySchema(db);
  await seedDatabase(db);
  stack = await startStack(db, new InMemoryBus());
  const urls: Record<string, string> = {
    quote_url: stack.urls.quote,
    policy_url: stack.urls.policy,
    claims_url: stack.urls.claims,
  };
  for (const v of env.values) v.value = urls[v.key] ?? v.value;
}

const failures = await new Promise<number>((resolve, reject) => {
  newman.run(
    {
      collection: JSON.parse(
        readFileSync('tests/postman/insurance-platform.postman_collection.json', 'utf8'),
      ),
      environment: env,
      reporters: ['cli', 'junit', 'htmlextra'],
      reporter: {
        junit: { export: 'reports/junit-newman.xml' },
        htmlextra: {
          export: 'reports/newman-report.html',
          title: 'Insurance platform API regression',
        },
      },
    },
    (err: Error | null, summary: any) => (err ? reject(err) : resolve(summary.run.failures.length)),
  );
});

if (stack) await stack.stop();
console.log(failures === 0 ? 'Newman: all assertions passed' : `Newman: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
