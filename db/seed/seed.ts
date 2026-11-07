import { randomUUID } from 'node:crypto';
import { faker } from '@faker-js/faker';
import { dbFromEnv, type Db } from '../../shared/src/db.js';
import { allocateShares, DEFAULT_PANEL } from '../../shared/src/coinsurance.js';
import { calculatePremiumCents, type RiskType } from '../../shared/src/pricing.js';
import { audit } from '../../shared/src/outbox.js';

export interface SeedOptions {
  brokers?: number;
  policies?: number;
  seed?: number;
}

/**
 * Seed fake data only (faker, fixed seed => reproducible). Company names are generated, so any
 * resemblance to real organisations is coincidental. Seeded policies use the correct
 * largest-remainder split, so seed data itself is internally consistent.
 */
export async function seedDatabase(
  db: Db,
  opts: SeedOptions = {},
): Promise<{ policyIds: string[] }> {
  faker.seed(opts.seed ?? 20260101);
  const brokerIds: string[] = [];
  for (let i = 0; i < (opts.brokers ?? 8); i++) {
    const id = randomUUID();
    brokerIds.push(id);
    await db.query('INSERT INTO brokers (id, name, email) VALUES ($1,$2,$3)', [
      id,
      `${faker.company.name()} Brokers`,
      `broker${i}.${faker.string.alphanumeric(6).toLowerCase()}@example.test`,
    ]);
  }

  const policyIds: string[] = [];
  const types: RiskType[] = ['marine_cargo', 'commercial_property'];
  for (let i = 0; i < (opts.policies ?? 12); i++) {
    const type = types[i % 2];
    const value =
      faker.number.int({ min: 20_000, max: 5_000_000 }) * 100 +
      faker.number.int({ min: 0, max: 99 });
    const premium = calculatePremiumCents(type, value);
    const riskId = randomUUID();
    const quoteId = randomUUID();
    const policyId = randomUUID();
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO risks (id, broker_id, risk_type, insured_value_cents, description, status)
         VALUES ($1,$2,$3,$4,$5,'BOUND')`,
        [
          riskId,
          faker.helpers.arrayElement(brokerIds),
          type,
          value,
          faker.commerce.productDescription().slice(0, 200),
        ],
      );
      await q.query(
        `INSERT INTO quotes (id, risk_id, premium_cents, status) VALUES ($1,$2,$3,'ACCEPTED')`,
        [quoteId, riskId, premium],
      );
      await q.query(
        `INSERT INTO policies (id, policy_ref, quote_id, status, sum_insured_cents, total_premium_cents)
         VALUES ($1,$2,$3,'BOUND',$4,$5)`,
        [policyId, `POL-SEED${String(i).padStart(4, '0')}`, quoteId, value, premium],
      );
      for (const s of allocateShares(premium, DEFAULT_PANEL)) {
        await q.query(
          `INSERT INTO insurer_shares (id, policy_id, insurer, share_bps, amount_cents) VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), policyId, s.insurer, s.bps, s.amountCents],
        );
      }
      await q.query(`INSERT INTO premiums (id, policy_id, amount_cents) VALUES ($1,$2,$3)`, [
        randomUUID(),
        policyId,
        premium,
      ]);
      await audit(q, 'risk', riskId, null, 'SUBMITTED');
      await audit(q, 'risk', riskId, 'SUBMITTED', 'QUOTED');
      await audit(q, 'risk', riskId, 'QUOTED', 'BOUND');
      await audit(q, 'quote', quoteId, null, 'QUOTED');
      await audit(q, 'quote', quoteId, 'QUOTED', 'ACCEPTED');
      await audit(q, 'policy', policyId, null, 'BOUND');
    });
    policyIds.push(policyId);
  }
  return { policyIds };
}

// CLI: `npm run seed` (requires DATABASE_URL, schema already applied)
if (process.argv[1]?.replace(/\\/g, '/').endsWith('db/seed/seed.ts')) {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required, e.g. postgres://demo:demo@localhost:5432/insurance');
    console.error(
      'Start the stack with docker compose first. `npm run dev` seeds its own database.',
    );
    process.exit(2);
  }
  const db = await dbFromEnv();
  const { policyIds } = await seedDatabase(db);
  console.log(`Seeded ${policyIds.length} policies`);
  await db.close();
}
