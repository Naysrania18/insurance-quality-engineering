import { randomUUID } from 'node:crypto';
import amqp from 'amqplib';

export interface DomainEvent<T = any> {
  eventId: string;
  type: 'PolicyBound' | 'ClaimNotified' | 'ClaimSettled' | string;
  occurredAt: string;
  version: 1;
  data: T;
}

export type Handler = (e: DomainEvent) => Promise<void>;

export interface Subscription {
  stop(): Promise<void>;
}

/**
 * Minimal event bus abstraction. Two implementations (in-memory and RabbitMQ) share the
 * same semantics: durable named queues, at-least-once delivery, buffering while a consumer is down.
 */
export interface EventBus {
  publish(e: DomainEvent): Promise<void>;
  subscribe(consumer: string, types: string[], handler: Handler): Promise<Subscription>;
  /** Events that exhausted their retries, per consumer. */
  deadLetters(consumer: string): DomainEvent[];
  close(): Promise<void>;
}

export function newEvent<T>(type: string, data: T): DomainEvent<T> {
  return { eventId: randomUUID(), type, occurredAt: new Date().toISOString(), version: 1, data };
}

const MAX_ATTEMPTS = 3;

async function runWithRetry(handler: Handler, e: DomainEvent): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await handler(e);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 25 * attempt));
    }
  }
  return false;
}

interface MemQueue {
  types: string[];
  msgs: DomainEvent[];
  handler?: Handler;
  draining: boolean;
  dead: DomainEvent[];
}

export class InMemoryBus implements EventBus {
  private queues = new Map<string, MemQueue>();

  async publish(e: DomainEvent): Promise<void> {
    for (const q of this.queues.values()) {
      if (q.types.includes(e.type)) {
        q.msgs.push(structuredClone(e));
        void this.drain(q);
      }
    }
  }

  async subscribe(consumer: string, types: string[], handler: Handler): Promise<Subscription> {
    let q = this.queues.get(consumer);
    if (!q) {
      q = { types, msgs: [], draining: false, dead: [] };
      this.queues.set(consumer, q);
    }
    q.handler = handler;
    void this.drain(q);
    const queue = q;
    return {
      stop: async () => {
        queue.handler = undefined;
        while (queue.draining) await new Promise((r) => setTimeout(r, 5));
      },
    };
  }

  private async drain(q: MemQueue): Promise<void> {
    if (q.draining) return;
    q.draining = true;
    try {
      while (q.handler && q.msgs.length > 0) {
        const msg = q.msgs[0];
        const ok = await runWithRetry(q.handler, msg);
        q.msgs.shift();
        if (!ok) q.dead.push(msg);
      }
    } finally {
      q.draining = false;
    }
  }

  deadLetters(consumer: string): DomainEvent[] {
    return this.queues.get(consumer)?.dead ?? [];
  }

  async close(): Promise<void> {
    for (const q of this.queues.values()) q.handler = undefined;
  }
}

const EXCHANGE = 'insurance.events';

interface RabbitSub {
  consumer: string;
  types: string[];
  handler: Handler;
  stopped: boolean;
  channel?: any;
}

export class RabbitBus implements EventBus {
  private conn: any = null;
  private pubChannel: any = null;
  private subs: RabbitSub[] = [];
  private dead = new Map<string, DomainEvent[]>();
  private closed = false;

  constructor(private url: string) {}

  private async connection(): Promise<any> {
    if (this.conn) return this.conn;
    const conn: any = await amqp.connect(this.url);
    conn.on('error', () => undefined);
    conn.on('close', () => {
      this.conn = null;
      this.pubChannel = null;
      if (!this.closed) setTimeout(() => void this.resubscribeAll(), 1000);
    });
    this.conn = conn;
    return conn;
  }

  private async publisher(): Promise<any> {
    if (this.pubChannel) return this.pubChannel;
    const conn = await this.connection();
    const ch = await conn.createConfirmChannel();
    ch.on('error', () => undefined);
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
    this.pubChannel = ch;
    return ch;
  }

  async publish(e: DomainEvent): Promise<void> {
    try {
      const ch = await this.publisher();
      await new Promise<void>((resolve, reject) => {
        ch.publish(
          EXCHANGE,
          e.type,
          Buffer.from(JSON.stringify(e)),
          { persistent: true, contentType: 'application/json', messageId: e.eventId },
          (err: unknown) => (err ? reject(err) : resolve()),
        );
      });
    } catch (err) {
      this.pubChannel = null;
      throw err;
    }
  }

  private async attach(sub: RabbitSub): Promise<void> {
    const conn = await this.connection();
    const ch = await conn.createChannel();
    ch.on('error', () => undefined);
    await ch.assertExchange(EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(`${sub.consumer}.dlq`, { durable: true });
    await ch.assertQueue(sub.consumer, {
      durable: true,
      deadLetterExchange: '',
      deadLetterRoutingKey: `${sub.consumer}.dlq`,
    });
    for (const t of sub.types) await ch.bindQueue(sub.consumer, EXCHANGE, t);
    await ch.prefetch(1);
    await ch.consume(sub.consumer, async (msg: any) => {
      if (!msg) return;
      const event = JSON.parse(msg.content.toString()) as DomainEvent;
      const ok = await runWithRetry(sub.handler, event);
      if (ok) ch.ack(msg);
      else {
        const list = this.dead.get(sub.consumer) ?? [];
        list.push(event);
        this.dead.set(sub.consumer, list);
        ch.nack(msg, false, false);
      }
    });
    sub.channel = ch;
  }

  private async resubscribeAll(): Promise<void> {
    for (const sub of this.subs) {
      if (sub.stopped) continue;
      try {
        await this.attach(sub);
      } catch {
        setTimeout(() => void this.resubscribeAll(), 1000);
        return;
      }
    }
  }

  async subscribe(consumer: string, types: string[], handler: Handler): Promise<Subscription> {
    const sub: RabbitSub = { consumer, types, handler, stopped: false };
    this.subs.push(sub);
    await this.attach(sub);
    return {
      stop: async () => {
        sub.stopped = true;
        this.subs = this.subs.filter((s) => s !== sub);
        try {
          await sub.channel?.close();
        } catch {
          /* channel already closed */
        }
      },
    };
  }

  deadLetters(consumer: string): DomainEvent[] {
    return this.dead.get(consumer) ?? [];
  }

  async close(): Promise<void> {
    this.closed = true;
    try {
      await this.conn?.close();
    } catch {
      /* ignore */
    }
  }
}

export function busFromEnv(): EventBus {
  const url = process.env.RABBITMQ_URL;
  return url ? new RabbitBus(url) : new InMemoryBus();
}
