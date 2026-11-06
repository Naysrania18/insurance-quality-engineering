import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../../shared/src/db.js';
import { ApiError } from '../../../shared/src/errors.js';
import { createBaseApp, shortRef } from '../../../shared/src/http.js';
import { audit, enqueueEvent } from '../../../shared/src/outbox.js';
import type { PolicyClient } from './policy-client.js';

const notifySchema = z.object({
  policyId: z.uuid(),
  lossDate: z.iso.date(),
  amountClaimedCents: z.number().int().positive(),
  description: z.string().min(1).max(500),
});
const assessSchema = z.object({ assessedCents: z.number().int().positive() });
const settleSchema = z.object({ settledCents: z.number().int().positive() });

const claimOut = (c: any) => ({
  id: c.id,
  claimRef: c.claim_ref,
  policyId: c.policy_id,
  lossDate: c.loss_date instanceof Date ? c.loss_date.toISOString().slice(0, 10) : c.loss_date,
  amountClaimedCents: Number(c.amount_claimed_cents),
  assessedCents: c.assessed_cents === null ? null : Number(c.assessed_cents),
  settledCents: c.settled_cents === null ? null : Number(c.settled_cents),
  description: c.description,
  status: c.status,
});

export function createClaimsApp(db: Db, policies: PolicyClient) {
  const { app, finish } = createBaseApp(
    'claims-service',
    new URL('../openapi.yaml', import.meta.url),
  );

  app.post('/claims', async (req, res) => {
    const body = notifySchema.parse(req.body);
    if (new Date(body.lossDate) > new Date()) {
      throw new ApiError(400, 'validation_error', 'lossDate cannot be in the future');
    }
    const policy = await policies.getPolicy(body.policyId);
    if (!policy) throw new ApiError(404, 'policy_not_found', 'Policy not found');
    if (policy.status !== 'BOUND') throw new ApiError(409, 'policy_not_active', 'Policy is not active');
    if (body.amountClaimedCents > policy.sumInsuredCents) {
      throw new ApiError(422, 'claim_exceeds_sum_insured', 'Claim exceeds the sum insured');
    }

    // PLANTED DEFECT DEF-002: there is no duplicate check here. A correct implementation would reject a
    // second claim with the same (policyId, lossDate, amountClaimedCents) with 409 duplicate_claim.
    // See docs/planted-defects.md and docs/defects/DEF-002-duplicate-claims.md.

    const id = randomUUID();
    const claim = await db.tx(async (q) => {
      const r = await q.query(
        `INSERT INTO claims (id, claim_ref, policy_id, loss_date, amount_claimed_cents, description, status)
         VALUES ($1,$2,$3,$4,$5,$6,'NOTIFIED') RETURNING *`,
        [id, shortRef('CLM'), body.policyId, body.lossDate, body.amountClaimedCents, body.description],
      );
      await audit(q, 'claim', id, null, 'NOTIFIED');
      await enqueueEvent(q, 'ClaimNotified', {
        claimId: id,
        policyId: body.policyId,
        amountClaimedCents: body.amountClaimedCents,
      });
      return r.rows[0];
    });
    res.status(201).json(claimOut(claim));
  });

  app.get('/claims', async (req, res) => {
    const policyId = typeof req.query.policyId === 'string' ? req.query.policyId : null;
    if (policyId) z.uuid().parse(policyId);
    const { rows } = await db.query(
      `SELECT * FROM claims WHERE ($1::uuid IS NULL OR policy_id = $1) ORDER BY created_at DESC LIMIT 100`,
      [policyId],
    );
    res.json(rows.map(claimOut));
  });

  app.get('/claims/:id', async (req, res) => {
    z.uuid().parse(req.params.id);
    const { rows } = await db.query('SELECT * FROM claims WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new ApiError(404, 'claim_not_found', 'Claim not found');
    res.json(claimOut(rows[0]));
  });

  app.post('/claims/:id/assess', async (req, res) => {
    z.uuid().parse(req.params.id);
    const body = assessSchema.parse(req.body);
    const claim = await db.tx(async (q) => {
      const r = await q.query('SELECT * FROM claims WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (r.rows.length === 0) throw new ApiError(404, 'claim_not_found', 'Claim not found');
      const c = r.rows[0];
      if (c.status !== 'NOTIFIED') {
        throw new ApiError(409, 'invalid_transition', `Cannot assess a ${c.status} claim`);
      }
      if (body.assessedCents > Number(c.amount_claimed_cents)) {
        throw new ApiError(422, 'assessment_exceeds_claim', 'Assessed amount exceeds amount claimed');
      }
      const u = await q.query(
        `UPDATE claims SET status = 'ASSESSED', assessed_cents = $2 WHERE id = $1 RETURNING *`,
        [c.id, body.assessedCents],
      );
      await audit(q, 'claim', c.id, 'NOTIFIED', 'ASSESSED');
      return u.rows[0];
    });
    res.json(claimOut(claim));
  });

  app.post('/claims/:id/settle', async (req, res) => {
    z.uuid().parse(req.params.id);
    const body = settleSchema.parse(req.body);
    const claim = await db.tx(async (q) => {
      const r = await q.query('SELECT * FROM claims WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (r.rows.length === 0) throw new ApiError(404, 'claim_not_found', 'Claim not found');
      const c = r.rows[0];
      if (c.status !== 'ASSESSED') {
        throw new ApiError(409, 'invalid_transition', `Cannot settle a ${c.status} claim`);
      }
      if (body.settledCents > Number(c.assessed_cents)) {
        throw new ApiError(422, 'settlement_exceeds_assessment', 'Settlement exceeds assessed amount');
      }
      const u = await q.query(
        `UPDATE claims SET status = 'SETTLED', settled_cents = $2 WHERE id = $1 RETURNING *`,
        [c.id, body.settledCents],
      );
      // PLANTED DEFECT DEF-003: the audit_log write for ASSESSED -> SETTLED is missing here.
      // See docs/planted-defects.md and docs/defects/DEF-003-missing-settlement-audit.md.
      await enqueueEvent(q, 'ClaimSettled', {
        claimId: c.id,
        policyId: c.policy_id,
        settledCents: body.settledCents,
      });
      return u.rows[0];
    });
    res.json(claimOut(claim));
  });

  finish();
  return app;
}
