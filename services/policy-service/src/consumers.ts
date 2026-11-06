import type { Db, Queryable } from '../../../shared/src/db.js';
import type { DomainEvent, EventBus, Subscription } from '../../../shared/src/events.js';
import { processOnce } from '../../../shared/src/outbox.js';

export const POLICY_CONSUMER = 'policy-service.claims';

/** Recompute a policy's claim counters from the order-independent ledger. */
async function refreshPolicy(q: Queryable, policyId: string): Promise<void> {
  await q.query(
    `UPDATE policies SET
       open_claims = (SELECT COUNT(*) FROM policy_claim_ledger
                      WHERE policy_id = $1 AND notified AND settled_cents IS NULL),
       claims_paid_cents = (SELECT COALESCE(SUM(settled_cents), 0) FROM policy_claim_ledger
                            WHERE policy_id = $1)
     WHERE id = $1`,
    [policyId],
  );
}

/**
 * Handle claim events. Safe under duplicates (processOnce) and out-of-order delivery
 * (ledger upserts are commutative, counters are derived).
 */
export function policyClaimHandler(db: Db) {
  return async (e: DomainEvent): Promise<void> => {
    await processOnce(db, POLICY_CONSUMER, e, async (q) => {
      if (e.type === 'ClaimNotified') {
        await q.query(
          `INSERT INTO policy_claim_ledger (claim_id, policy_id, notified) VALUES ($1,$2,TRUE)
           ON CONFLICT (claim_id) DO UPDATE SET notified = TRUE`,
          [e.data.claimId, e.data.policyId],
        );
        await refreshPolicy(q, e.data.policyId);
      } else if (e.type === 'ClaimSettled') {
        await q.query(
          `INSERT INTO policy_claim_ledger (claim_id, policy_id, settled_cents) VALUES ($1,$2,$3)
           ON CONFLICT (claim_id) DO UPDATE SET settled_cents = EXCLUDED.settled_cents`,
          [e.data.claimId, e.data.policyId, e.data.settledCents],
        );
        await refreshPolicy(q, e.data.policyId);
      }
    });
  };
}

export function startPolicyConsumers(db: Db, bus: EventBus): Promise<Subscription> {
  return bus.subscribe(POLICY_CONSUMER, ['ClaimNotified', 'ClaimSettled'], policyClaimHandler(db));
}
