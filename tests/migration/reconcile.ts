import { createHash } from 'node:crypto';
import type { Db } from '../../shared/src/db.js';
import {
  toTarget,
  type LegacyRow,
  type MigrationStats,
} from '../../db/migrations/migrate-v1-to-v2.js';

export interface FieldDiff {
  policyNo: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface Reconciliation {
  counts: { legacy: number; migrated: number; rejected: number; balanced: boolean };
  checksums: {
    premiumLegacyCents: number;
    premiumMigratedCents: number;
    insuredLegacyCents: number;
    insuredMigratedCents: number;
    legacyHash: string;
    migratedHash: string;
    match: boolean;
  };
  fieldDiffs: FieldDiff[];
  rejects: { policy_no: string; reason: string }[];
  passed: boolean;
}

const line = (
  ref: string,
  status: string,
  sum: number,
  prem: number,
  panel: { insurer: string; bps: number }[],
) =>
  `${ref}|${status}|${sum}|${prem}|${[...panel]
    .sort((a, b) => a.insurer.localeCompare(b.insurer))
    .map((m) => `${m.insurer}:${m.bps}`)
    .join(';')}`;

export async function reconcile(db: Db, stats: MigrationStats): Promise<Reconciliation> {
  const legacy = (
    await db.query<LegacyRow>('SELECT * FROM legacy_policies ORDER BY policy_no, row_id')
  ).rows;
  const rejects = (
    await db.query('SELECT policy_no, reason FROM migration_rejects ORDER BY policy_no')
  ).rows as any[];
  const rejectedRowIds = new Set(
    (await db.query('SELECT row_id FROM migration_rejects')).rows.map((r: any) => Number(r.row_id)),
  );
  const expectedRows = legacy.filter((r) => !rejectedRowIds.has(r.row_id));

  const migrated = (
    await db.query(
      `SELECT p.policy_ref, p.status, p.sum_insured_cents, p.total_premium_cents,
              COALESCE(json_agg(json_build_object('insurer', s.insurer, 'bps', s.share_bps)) FILTER (WHERE s.id IS NOT NULL), '[]') AS panel
       FROM policies p LEFT JOIN insurer_shares s ON s.policy_id = p.id
       WHERE p.policy_ref LIKE 'LEG-%'
       GROUP BY p.id ORDER BY p.policy_ref`,
    )
  ).rows as any[];

  // 1. Record counts: every legacy row is either migrated or quarantined.
  const counts = {
    legacy: legacy.length,
    migrated: migrated.length,
    rejected: rejects.length,
    balanced:
      legacy.length === migrated.length + rejects.length && stats.migrated === migrated.length,
  };

  // 2. Checksums: totals and an order-independent hash of normalised key fields.
  const expected = expectedRows.map((r) => toTarget(r));
  const legacyLines = expected
    .map((t) => line(t.policyRef, t.status, t.sumInsuredCents, t.premiumCents, t.panel))
    .sort();
  const migratedLines = migrated
    .map((m) =>
      line(
        m.policy_ref,
        m.status,
        Number(m.sum_insured_cents),
        Number(m.total_premium_cents),
        typeof m.panel === 'string' ? JSON.parse(m.panel) : m.panel,
      ),
    )
    .sort();
  const hash = (xs: string[]) => createHash('sha256').update(xs.join('\n')).digest('hex');
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const checksums = {
    premiumLegacyCents: sum(expected.map((t) => t.premiumCents)),
    premiumMigratedCents: sum(migrated.map((m) => Number(m.total_premium_cents))),
    insuredLegacyCents: sum(expected.map((t) => t.sumInsuredCents)),
    insuredMigratedCents: sum(migrated.map((m) => Number(m.sum_insured_cents))),
    legacyHash: hash(legacyLines),
    migratedHash: hash(migratedLines),
    match: false,
  };
  checksums.match =
    checksums.premiumLegacyCents === checksums.premiumMigratedCents &&
    checksums.insuredLegacyCents === checksums.insuredMigratedCents &&
    checksums.legacyHash === checksums.migratedHash;

  // 3. Field-level reconciliation, record by record.
  const byRef = new Map(migrated.map((m) => [m.policy_ref as string, m]));
  const fieldDiffs: FieldDiff[] = [];
  for (const t of expected) {
    const m = byRef.get(t.policyRef);
    if (!m) {
      fieldDiffs.push({
        policyNo: t.policyRef,
        field: 'record',
        expected: 'present',
        actual: 'missing',
      });
      continue;
    }
    const check = (field: string, e: unknown, a: unknown) => {
      if (JSON.stringify(e) !== JSON.stringify(a))
        fieldDiffs.push({ policyNo: t.policyRef, field, expected: e, actual: a });
    };
    check('status', t.status, m.status);
    check('sum_insured_cents', t.sumInsuredCents, Number(m.sum_insured_cents));
    check('total_premium_cents', t.premiumCents, Number(m.total_premium_cents));
    const panel = (typeof m.panel === 'string' ? JSON.parse(m.panel) : m.panel) as {
      insurer: string;
      bps: number;
    }[];
    const norm = (p: { insurer: string; bps: number }[]) =>
      [...p].sort((a, b) => a.insurer.localeCompare(b.insurer));
    check('insurer_shares', norm(t.panel), norm(panel));
  }

  // 4. Migrated shares must add up to each premium (the same invariant as the SQL validation suite).
  const shareMismatch = (
    await db.query(
      `SELECT p.policy_ref FROM policies p JOIN insurer_shares s ON s.policy_id = p.id
       WHERE p.policy_ref LIKE 'LEG-%' GROUP BY p.id, p.policy_ref, p.total_premium_cents
       HAVING SUM(s.amount_cents) <> p.total_premium_cents`,
    )
  ).rows as any[];
  for (const r of shareMismatch) {
    fieldDiffs.push({
      policyNo: r.policy_ref,
      field: 'shares_sum',
      expected: 'premium',
      actual: 'mismatch',
    });
  }

  return {
    counts,
    checksums,
    fieldDiffs,
    rejects,
    passed: counts.balanced && checksums.match && fieldDiffs.length === 0,
  };
}

export function renderReport(stats: MigrationStats, r: Reconciliation): string {
  const ok = (b: boolean) => (b ? 'PASS' : 'FAIL');
  const money = (c: number) => (c / 100).toFixed(2);
  return `# Data migration reconciliation report (v1 -> v2)

Overall result: **${ok(r.passed)}**

## 1. Record counts
| Measure | Value |
| --- | ---: |
| Legacy rows read | ${r.counts.legacy} |
| Migrated to v2 | ${r.counts.migrated} |
| Rejected (quarantined) | ${r.counts.rejected} |
| migrated + rejected = legacy | ${ok(r.counts.balanced)} |

Migration run stats: read ${stats.read}, migrated ${stats.migrated}, rejected ${stats.rejected}.

## 2. Checksums
| Measure | Legacy (expected) | v2 (actual) | Result |
| --- | ---: | ---: | --- |
| Total premium | ${money(r.checksums.premiumLegacyCents)} | ${money(r.checksums.premiumMigratedCents)} | ${ok(r.checksums.premiumLegacyCents === r.checksums.premiumMigratedCents)} |
| Total insured value | ${money(r.checksums.insuredLegacyCents)} | ${money(r.checksums.insuredMigratedCents)} | ${ok(r.checksums.insuredLegacyCents === r.checksums.insuredMigratedCents)} |
| SHA-256 of normalised records | \`${r.checksums.legacyHash.slice(0, 16)}...\` | \`${r.checksums.migratedHash.slice(0, 16)}...\` | ${ok(r.checksums.legacyHash === r.checksums.migratedHash)} |

## 3. Field-level reconciliation
Fields compared per policy: status, sum insured, premium, insurer names and shares, share amounts sum to premium.

Differences found: **${r.fieldDiffs.length}**
${
  r.fieldDiffs.length
    ? r.fieldDiffs
        .slice(0, 20)
        .map(
          (d) =>
            `- ${d.policyNo} ${d.field}: expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`,
        )
        .join('\n')
    : '_None._'
}

## 4. Rejected records (quarantined, not lost)
| Policy no | Reason |
| --- | --- |
${r.rejects.map((x) => `| ${x.policy_no} | ${x.reason} |`).join('\n') || '| - | - |'}
`;
}
