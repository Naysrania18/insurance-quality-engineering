import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applySchema, pgDb, pgliteDb, type Db } from '../../shared/src/db.js';
import { decimalToCents, migrateV1ToV2, type MigrationStats } from '../../db/migrations/migrate-v1-to-v2.js';
import { EXPECTED_REJECTS, loadLegacyData } from './legacy-data.js';
import { reconcile, renderReport, type Reconciliation } from './reconcile.js';

describe('decimalToCents (no floating point)', () => {
  it.each([
    ['0', 0],
    ['1234.5', 123450],
    ['1234.56', 123456],
    ['0.07', 7],
    ['19.995', 2000],
    ['19.994', 1999],
    ['-5.25', -525],
  ])('%s -> %i', (input, expected) => {
    expect(decimalToCents(input)).toBe(expected);
  });
  it('rejects garbage', () => {
    expect(() => decimalToCents('12,5')).toThrow();
  });
});

describe('v1 -> v2 migration with reconciliation', () => {
  let db: Db;
  let stats: MigrationStats;
  let rec: Reconciliation;

  beforeAll(async () => {
    // Uses a throwaway database: in-process by default, or MIGRATION_DATABASE_URL (a scratch Postgres DB).
    db = process.env.MIGRATION_DATABASE_URL ? pgDb(process.env.MIGRATION_DATABASE_URL) : await pgliteDb();
    await applySchema(db);
    await loadLegacyData(db);
    stats = await migrateV1ToV2(db);
    rec = await reconcile(db, stats);
    mkdirSync('reports', { recursive: true });
    writeFileSync('reports/migration-report.md', renderReport(stats, rec));
  });
  afterAll(async () => {
    await db.close();
  });

  it('accounts for every legacy record: migrated + rejected = legacy', () => {
    expect(rec.counts.legacy).toBe(201); // 200 generated + 1 duplicate row
    expect(rec.counts.balanced).toBe(true);
    expect(stats.migrated + stats.rejected).toBe(stats.read);
  });

  it('quarantines exactly the known-bad records, with the right reasons', () => {
    const actual = Object.fromEntries(rec.rejects.map((r) => [r.policy_no, r.reason]));
    expect(actual).toEqual(EXPECTED_REJECTS);
  });

  it('matches premium and insured-value totals and the record hash', () => {
    expect(rec.checksums.premiumMigratedCents).toBe(rec.checksums.premiumLegacyCents);
    expect(rec.checksums.insuredMigratedCents).toBe(rec.checksums.insuredLegacyCents);
    expect(rec.checksums.migratedHash).toBe(rec.checksums.legacyHash);
  });

  it('has zero field-level differences', () => {
    expect(rec.fieldDiffs).toEqual([]);
  });

  it('maps cancelled legacy policies to CANCELLED', async () => {
    const r = await db.query(`SELECT COUNT(*)::int AS n FROM policies WHERE status = 'CANCELLED'`);
    expect(r.rows[0].n).toBeGreaterThan(0);
  });

  it('is detectable when migration goes wrong (reconciliation has teeth)', async () => {
    await db.query(`UPDATE policies SET total_premium_cents = total_premium_cents + 1 WHERE policy_ref = 'LEG-000002'`);
    const broken = await reconcile(db, stats);
    expect(broken.passed).toBe(false);
    expect(broken.fieldDiffs.some((d) => d.policyNo === 'LEG-000002' && d.field === 'total_premium_cents')).toBe(true);
    expect(broken.checksums.match).toBe(false);
    await db.query(`UPDATE policies SET total_premium_cents = total_premium_cents - 1 WHERE policy_ref = 'LEG-000002'`);
  });

  it('migrated shares add up to each premium', async () => {
    const r = await db.query(
      `SELECT p.policy_ref FROM policies p JOIN insurer_shares s ON s.policy_id = p.id
       WHERE p.policy_ref LIKE 'LEG-%' GROUP BY p.id, p.policy_ref, p.total_premium_cents
       HAVING SUM(s.amount_cents) <> p.total_premium_cents`,
    );
    expect(r.rows).toEqual([]);
  });
});
