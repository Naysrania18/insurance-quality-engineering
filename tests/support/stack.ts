import { applySchema, pgDb, pgliteDb, type Db } from '../../shared/src/db.js';
import { InMemoryBus, RabbitBus, type EventBus } from '../../shared/src/events.js';
import { startStack } from '../../shared/src/stack.js';
import { seedDatabase } from '../../db/seed/seed.js';

export interface Target {
  urls: { web: string; quote: string; policy: string; claims: string };
  db: Db;
  bus: EventBus;
  /** True when pointed at a running docker-compose stack (STACK_MODE=external). */
  external: boolean;
  flush(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Integration tests run against either:
 *  - an in-process stack (PGlite + in-memory bus; default, no Docker), or
 *  - the docker-compose stack when STACK_MODE=external (DATABASE_URL, *_URL env vars).
 * The assertions are identical in both modes.
 */
export async function useTarget(): Promise<Target> {
  if (process.env.STACK_MODE === 'external') {
    const db = pgDb(process.env.DATABASE_URL ?? 'postgres://demo:demo@localhost:5432/insurance');
    const bus = process.env.RABBITMQ_URL
      ? new RabbitBus(process.env.RABBITMQ_URL)
      : new InMemoryBus();
    return {
      urls: {
        web: process.env.WEB_URL ?? 'http://localhost:3000',
        quote: process.env.QUOTE_URL ?? 'http://localhost:3001',
        policy: process.env.POLICY_URL ?? 'http://localhost:3002',
        claims: process.env.CLAIMS_URL ?? 'http://localhost:3003',
      },
      db,
      bus,
      external: true,
      flush: async () => undefined,
      stop: async () => {
        await bus.close();
        await db.close();
      },
    };
  }
  const db = await pgliteDb();
  await applySchema(db);
  await seedDatabase(db);
  const bus = new InMemoryBus();
  const stack = await startStack(db, bus);
  return {
    urls: stack.urls,
    db,
    bus,
    external: false,
    flush: () => stack.flushEvents(),
    stop: async () => {
      await stack.stop();
      await db.close();
    },
  };
}

/** A fresh isolated database + bus (no HTTP) for event-handler tests. Bus is RabbitMQ if RABBITMQ_URL is set. */
export async function useIsolatedEventEnv(): Promise<{
  db: Db;
  bus: EventBus;
  stop(): Promise<void>;
}> {
  const db = await pgliteDb();
  await applySchema(db);
  const bus: EventBus = process.env.RABBITMQ_URL
    ? new RabbitBus(process.env.RABBITMQ_URL)
    : new InMemoryBus();
  return {
    db,
    bus,
    stop: async () => {
      await bus.close();
      await db.close();
    },
  };
}
