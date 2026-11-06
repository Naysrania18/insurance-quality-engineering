/**
 * Data-integrity checks. Every query returns the OFFENDING rows, so an empty result means "pass"
 * and a failure message can show exactly which records are wrong.
 */
export const checks = {
  premiumEqualsSumOfShares: `
    SELECT p.id AS policy_id, p.policy_ref, p.total_premium_cents,
           SUM(s.amount_cents) AS shares_total
    FROM policies p JOIN insurer_shares s ON s.policy_id = p.id
    GROUP BY p.id, p.policy_ref, p.total_premium_cents
    HAVING SUM(s.amount_cents) <> p.total_premium_cents`,

  sharesTotalOneHundredPercent: `
    SELECT policy_id, SUM(share_bps) AS total_bps
    FROM insurer_shares GROUP BY policy_id HAVING SUM(share_bps) <> 10000`,

  policiesWithoutShares: `
    SELECT p.id AS policy_id FROM policies p
    LEFT JOIN insurer_shares s ON s.policy_id = p.id WHERE s.id IS NULL`,

  premiumRowMatchesPolicyAndQuote: `
    SELECT p.id AS policy_id FROM policies p
    JOIN quotes q ON q.id = p.quote_id
    LEFT JOIN premiums pr ON pr.policy_id = p.id
    WHERE pr.amount_cents IS DISTINCT FROM p.total_premium_cents
       OR q.premium_cents <> p.total_premium_cents`,

  orphanClaims: `
    SELECT c.id AS claim_id FROM claims c
    LEFT JOIN policies p ON p.id = c.policy_id
    WHERE p.id IS NULL OR p.status <> 'BOUND'`,

  /** A claim in state X must have an audit row for every state it has passed through. */
  claimsMissingAuditForState: `
    SELECT c.id AS claim_id, c.status, st.state AS missing_state
    FROM claims c
    CROSS JOIN LATERAL (VALUES ('NOTIFIED', 1), ('ASSESSED', 2), ('SETTLED', 3)) AS st(state, rank)
    WHERE st.rank <= CASE c.status WHEN 'NOTIFIED' THEN 1 WHEN 'ASSESSED' THEN 2 ELSE 3 END
      AND NOT EXISTS (
        SELECT 1 FROM audit_log a
        WHERE a.entity = 'claim' AND a.entity_id = c.id AND a.to_state = st.state)`,

  policiesMissingBoundAudit: `
    SELECT p.id AS policy_id FROM policies p
    WHERE NOT EXISTS (SELECT 1 FROM audit_log a
                      WHERE a.entity = 'policy' AND a.entity_id = p.id AND a.to_state = 'BOUND')`,

  risksMissingAuditForCurrentState: `
    SELECT r.id AS risk_id, r.status FROM risks r
    WHERE NOT EXISTS (SELECT 1 FROM audit_log a
                      WHERE a.entity = 'risk' AND a.entity_id = r.id AND a.to_state = r.status)`,

  duplicateClaims: `
    SELECT policy_id, loss_date, amount_claimed_cents, COUNT(*) AS copies
    FROM claims GROUP BY policy_id, loss_date, amount_claimed_cents HAVING COUNT(*) > 1`,

  duplicatePolicyPerQuote: `
    SELECT quote_id, COUNT(*) AS copies FROM policies GROUP BY quote_id HAVING COUNT(*) > 1`,

  duplicateInsurerOnPolicy: `
    SELECT policy_id, insurer, COUNT(*) AS copies
    FROM insurer_shares GROUP BY policy_id, insurer HAVING COUNT(*) > 1`,

  duplicateOutboxEvents: `
    SELECT event_id, COUNT(*) AS copies FROM outbox GROUP BY event_id HAVING COUNT(*) > 1`,

  policyClaimsPaidMatchesSettledClaims: `
    SELECT p.id AS policy_id, p.claims_paid_cents, COALESCE(SUM(c.settled_cents), 0) AS settled_total
    FROM policies p LEFT JOIN claims c ON c.policy_id = p.id AND c.status = 'SETTLED'
    GROUP BY p.id, p.claims_paid_cents
    HAVING p.claims_paid_cents <> COALESCE(SUM(c.settled_cents), 0)`,
} as const;
