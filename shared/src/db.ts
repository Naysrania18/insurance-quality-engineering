import { readFileSync } from 'node:fs';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

export interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Run a multi-statement script (no parameters). */
  exec(sql: string): Promise<void>;
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function pgDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  // Without this handler an idle connection reset (DB restart, network cut) is an unhandled 'error'
  // event that crashes the process. Found by the Toxiproxy resilience tests.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  return {
    query: (sql, params) => pool.query(sql, params as any[]) as any,
    exec: async (sql) => {
      await pool.query(sql);
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (s, p) => client.query(s, p as any[]) as any });
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** In-process Postgres (WASM). Lets the whole stack run without Docker. */
export async function pgliteDb(): Promise<Db> {
  const lite = new PGlite();
  await lite.waitReady;
  return {
    query: (sql, params) => lite.query(sql, params as any[]) as any,
    exec: async (sql) => {
      await lite.exec(sql);
    },
    tx: (fn) => lite.transaction((t) => fn({ query: (s, p) => t.query(s, p as any[]) as any })),
    close: () => lite.close(),
  };
}

export async function dbFromEnv(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  return url ? pgDb(url) : pgliteDb();
}

export function schemaSql(): string {
  return readFileSync(new URL('../../db/schema.sql', import.meta.url), 'utf8');
}

/** Apply the v2 schema. Uses simple-query protocol for multi-statement SQL. */
export async function applySchema(db: Pick<Db, 'exec'>): Promise<void> {
  await db.exec(schemaSql());
}
