import { newEvent, type DomainEvent, type EventBus } from './events.js';
import type { Db, Queryable } from './db.js';

/** Write an event to the outbox inside the caller's transaction. */
export async function enqueueEvent<T>(
  q: Queryable,
  type: string,
  data: T,
): Promise<DomainEvent<T>> {
  const evt = newEvent(type, data);
  await q.query('INSERT INTO outbox (event_id, payload) VALUES ($1, $2)', [
    evt.eventId,
    JSON.stringify(evt),
  ]);
  return evt;
}

export interface Relay {
  flush(): Promise<number>;
  stop(): void;
}

/**
 * Relay unpublished outbox rows to the broker in order. If the broker is unavailable the rows stay
 * pending and are retried on the next tick (at-least-once delivery).
 */
export function startOutboxRelay(db: Db, bus: EventBus, intervalMs = 300): Relay {
  let running = false;
  const flush = async (): Promise<number> => {
    if (running) return 0;
    running = true;
    let sent = 0;
    try {
      const { rows } = await db.query<{ id: string; payload: string }>(
        'SELECT id, payload FROM outbox WHERE published_at IS NULL ORDER BY id LIMIT 50',
      );
      for (const row of rows) {
        await bus.publish(JSON.parse(row.payload));
        await db.query('UPDATE outbox SET published_at = now() WHERE id = $1', [row.id]);
        sent++;
      }
    } catch {
      /* broker or db unavailable: retry on next tick */
    } finally {
      running = false;
    }
    return sent;
  };
  const timer = setInterval(() => void flush(), intervalMs);
  return { flush, stop: () => clearInterval(timer) };
}

/** Run `fn` at most once per (consumer, eventId). Returns false for duplicates. */
export async function processOnce(
  db: Db,
  consumer: string,
  e: DomainEvent,
  fn: (q: Queryable) => Promise<void>,
): Promise<boolean> {
  return db.tx(async (q) => {
    const r = await q.query(
      'INSERT INTO processed_events (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id',
      [consumer, e.eventId],
    );
    if (r.rows.length === 0) return false;
    await fn(q);
    return true;
  });
}

export async function audit(
  q: Queryable,
  entity: string,
  entityId: string,
  from: string | null,
  to: string,
): Promise<void> {
  await q.query(
    'INSERT INTO audit_log (entity, entity_id, from_state, to_state) VALUES ($1, $2, $3, $4)',
    [entity, entityId, from, to],
  );
}
