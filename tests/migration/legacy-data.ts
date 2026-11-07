import { faker } from '@faker-js/faker';
import type { Db } from '../../shared/src/db.js';
import { legacySchemaSql } from '../../db/migrations/migrate-v1-to-v2.js';

/** Rows deliberately made unmigratable, so reconciliation has something real to catch. */
export const EXPECTED_REJECTS = {
  'LEG-000007': 'duplicate policy_no',
  'LEG-000013': 'shares total 99.99% (expected 100%)',
  'LEG-000021': 'premium must be positive',
} as const;

const INSURERS = ['Alder Mutual', 'Beacon Reinsurance', 'Cobalt Underwriters', 'Delta Syndicate'];

/** Generate `count` fake legacy policies (fake data only, fixed seed). */
export async function loadLegacyData(db: Db, count = 200): Promise<void> {
  await db.exec(legacySchemaSql());
  faker.seed(777);
  for (let i = 1; i <= count; i++) {
    const policyNo = `LEG-${String(i).padStart(6, '0')}`;
    const insured = faker.number.float({ min: 20_000, max: 4_000_000, fractionDigits: 2 });
    const premium = faker.number.float({ min: 200, max: 60_000, fractionDigits: 2 });
    const twoWay = i % 3 === 0;
    const shares = twoWay ? [60, 40, null] : [33.33, 33.33, 33.34];
    const names = faker.helpers.shuffle(INSURERS).slice(0, 3);
    await db.query(
      `INSERT INTO legacy_policies
        (policy_no, status, insured_value, premium, insurer1, share1, insurer2, share2, insurer3, share3, bound_on)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        policyNo,
        i % 17 === 0 ? 'C' : 'B',
        insured,
        i === 21 ? 0 : premium,
        names[0],
        shares[0],
        names[1],
        shares[1],
        shares[2] === null ? null : names[2],
        shares[2],
        faker.date.between({ from: '2019-01-01', to: '2025-12-31' }).toISOString().slice(0, 10),
      ],
    );
    if (i === 13) {
      // overwrite with shares that total 99.99%
      await db.query(
        `UPDATE legacy_policies SET share3 = 33.33, insurer3 = $2 WHERE policy_no = $1`,
        [policyNo, names[2]],
      );
    }
  }
  // duplicate of LEG-000007 (a second row with the same policy number)
  await db.query(
    `INSERT INTO legacy_policies (policy_no, status, insured_value, premium, insurer1, share1, insurer2, share2, bound_on)
     VALUES ('LEG-000007','B',100000.00,1000.00,'Alder Mutual',50,'Beacon Reinsurance',50,'2024-06-01')`,
  );
}
