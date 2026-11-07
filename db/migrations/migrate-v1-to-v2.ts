import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Db } from '../../shared/src/db.js';
import { allocateShares } from '../../shared/src/coinsurance.js';
import { audit } from '../../shared/src/outbox.js';

export const LEGACY_BROKER_EMAIL = 'legacy-migration@example.test';

/** Exact decimal string -> integer minor units (no floating point). "1234.5" -> 123450 */
export function decimalToCents(value: string | number): number {
  const s = String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new Error(`Not a decimal: ${s}`);
  const cents = Number(m[2]) * 100 + Number(((m[3] ?? '') + '00').slice(0, 2));
  const roundUp = (m[3] ?? '').length > 2 && Number(m[3][2]) >= 5 ? 1 : 0;
  return (m[1] ? -1 : 1) * (cents + roundUp);
}

export function legacySchemaSql(): string {
  return readFileSync(new URL('./v1-legacy-schema.sql', import.meta.url), 'utf8');
}

export interface LegacyRow {
  row_id: number;
  policy_no: string;
  status: string;
  insured_value: string;
  premium: string;
  insurer1: string | null;
  share1: string | null;
  insurer2: string | null;
  share2: string | null;
  insurer3: string | null;
  share3: string | null;
  bound_on: Date | string;
}

export interface MigrationStats {
  read: number;
  migrated: number;
  rejected: number;
}

/** Normalise a legacy row into the target shape (also used by reconciliation as the expected value). */
export function toTarget(row: LegacyRow) {
  const panel = [
    [row.insurer1, row.share1],
    [row.insurer2, row.share2],
    [row.insurer3, row.share3],
  ]
    .filter(([n, s]) => n && s !== null)
    .map(([n, s]) => ({ insurer: n as string, bps: decimalToCents(s as string) }));
  return {
    policyRef: row.policy_no,
    status: row.status === 'C' ? 'CANCELLED' : 'BOUND',
    sumInsuredCents: decimalToCents(row.insured_value),
    premiumCents: decimalToCents(row.premium),
    panel,
  };
}

/** Return a rejection reason or null if the row is migratable. */
export function validateLegacyRow(row: LegacyRow, seen: Set<string>): string | null {
  const t = toTarget(row);
  if (seen.has(row.policy_no)) return 'duplicate policy_no';
  if (t.premiumCents <= 0) return 'premium must be positive';
  if (t.sumInsuredCents <= 0) return 'insured value must be positive';
  if (t.panel.length === 0) return 'no insurers';
  const total = t.panel.reduce((s, m) => s + m.bps, 0);
  if (total !== 10_000) return `shares total ${total / 100}% (expected 100%)`;
  return null;
}

export async function migrateV1ToV2(db: Db): Promise<MigrationStats> {
  const { rows } = await db.query<LegacyRow>(
    'SELECT * FROM legacy_policies ORDER BY policy_no, row_id',
  );
  const stats: MigrationStats = { read: rows.length, migrated: 0, rejected: 0 };
  const seen = new Set<string>();

  await db.query(
    `INSERT INTO brokers (id, name, email) VALUES ($1,'Legacy Migration Broker',$2)
     ON CONFLICT (email) DO NOTHING`,
    [randomUUID(), LEGACY_BROKER_EMAIL],
  );
  const brokerId = (
    await db.query('SELECT id FROM brokers WHERE email = $1', [LEGACY_BROKER_EMAIL])
  ).rows[0].id;

  for (const row of rows) {
    const reason = validateLegacyRow(row, seen);
    if (reason) {
      await db.query(
        'INSERT INTO migration_rejects (policy_no, row_id, reason) VALUES ($1,$2,$3)',
        [row.policy_no, row.row_id, reason],
      );
      stats.rejected++;
      continue;
    }
    seen.add(row.policy_no);
    const t = toTarget(row);
    const riskId = randomUUID();
    const quoteId = randomUUID();
    const policyId = randomUUID();
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO risks (id, broker_id, risk_type, insured_value_cents, description, status)
         VALUES ($1,$2,'commercial_property',$3,$4,'BOUND')`,
        [riskId, brokerId, t.sumInsuredCents, `Migrated from legacy ${row.policy_no}`],
      );
      await q.query(
        `INSERT INTO quotes (id, risk_id, premium_cents, status) VALUES ($1,$2,$3,'ACCEPTED')`,
        [quoteId, riskId, t.premiumCents],
      );
      await q.query(
        `INSERT INTO policies (id, policy_ref, quote_id, status, sum_insured_cents, total_premium_cents, bound_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [policyId, t.policyRef, quoteId, t.status, t.sumInsuredCents, t.premiumCents, row.bound_on],
      );
      for (const s of allocateShares(t.premiumCents, t.panel)) {
        await q.query(
          `INSERT INTO insurer_shares (id, policy_id, insurer, share_bps, amount_cents) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), policyId, s.insurer, s.bps, s.amountCents],
        );
      }
      await q.query(`INSERT INTO premiums (id, policy_id, amount_cents) VALUES ($1,$2,$3)`, [
        randomUUID(),
        policyId,
        t.premiumCents,
      ]);
      await audit(q, 'policy', policyId, null, 'BOUND');
      await audit(q, 'risk', riskId, null, 'BOUND');
    });
    stats.migrated++;
  }
  return stats;
}
