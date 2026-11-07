import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../../shared/src/db.js';
import { ApiError } from '../../../shared/src/errors.js';
import { createBaseApp, isUniqueViolation, shortRef } from '../../../shared/src/http.js';
import { DEFAULT_PANEL, validatePanel, type PanelMember } from '../../../shared/src/coinsurance.js';
import { audit, enqueueEvent } from '../../../shared/src/outbox.js';
import { splitPremium } from './split.js';

const bindSchema = z.object({
  quoteId: z.uuid(),
  panel: z
    .array(z.object({ insurer: z.string().min(1).max(100), bps: z.number().int() }))
    .min(1)
    .max(10)
    .optional(),
});

async function loadPolicy(db: Db, id: string) {
  const p = await db.query('SELECT * FROM policies WHERE id = $1', [id]);
  if (p.rows.length === 0) return null;
  const s = await db.query(
    'SELECT insurer, share_bps, amount_cents FROM insurer_shares WHERE policy_id = $1 ORDER BY insurer',
    [id],
  );
  const row = p.rows[0];
  return {
    id: row.id,
    policyRef: row.policy_ref,
    quoteId: row.quote_id,
    status: row.status,
    sumInsuredCents: Number(row.sum_insured_cents),
    totalPremiumCents: Number(row.total_premium_cents),
    openClaims: row.open_claims,
    claimsPaidCents: Number(row.claims_paid_cents),
    boundAt: row.bound_at,
    shares: s.rows.map((x: any) => ({
      insurer: x.insurer,
      bps: x.share_bps,
      amountCents: Number(x.amount_cents),
    })),
  };
}

export function createPolicyApp(db: Db) {
  const { app, finish } = createBaseApp(
    'policy-service',
    new URL('../openapi.yaml', import.meta.url),
  );

  // Bind a quoted risk: creates the policy, splits the premium across the panel and emits PolicyBound.
  app.post('/policies', async (req, res) => {
    const body = bindSchema.parse(req.body);
    const panel: PanelMember[] = body.panel ?? DEFAULT_PANEL;
    validatePanel(panel);
    try {
      const policyId = await db.tx(async (q) => {
        const qr = await q.query('SELECT * FROM quotes WHERE id = $1 FOR UPDATE', [body.quoteId]);
        if (qr.rows.length === 0) throw new ApiError(404, 'quote_not_found', 'Quote not found');
        const quote = qr.rows[0];
        if (quote.status !== 'QUOTED') {
          throw new ApiError(409, 'quote_not_bindable', `Quote is ${quote.status}`);
        }
        const risk = (await q.query('SELECT * FROM risks WHERE id = $1', [quote.risk_id])).rows[0];
        const total = Number(quote.premium_cents);
        const id = randomUUID();
        const policyRef = shortRef('POL');
        await q.query(
          `INSERT INTO policies (id, policy_ref, quote_id, status, sum_insured_cents, total_premium_cents)
           VALUES ($1,$2,$3,'BOUND',$4,$5)`,
          [id, policyRef, quote.id, risk.insured_value_cents, total],
        );
        for (const s of splitPremium(total, panel)) {
          await q.query(
            `INSERT INTO insurer_shares (id, policy_id, insurer, share_bps, amount_cents)
             VALUES ($1,$2,$3,$4,$5)`,
            [randomUUID(), id, s.insurer, s.bps, s.amountCents],
          );
        }
        await q.query(
          `INSERT INTO premiums (id, policy_id, amount_cents, currency) VALUES ($1,$2,$3,$4)`,
          [randomUUID(), id, total, risk.currency],
        );
        await q.query(`UPDATE quotes SET status = 'ACCEPTED' WHERE id = $1`, [quote.id]);
        await q.query(`UPDATE risks SET status = 'BOUND' WHERE id = $1`, [risk.id]);
        await audit(q, 'policy', id, null, 'BOUND');
        await audit(q, 'quote', quote.id, 'QUOTED', 'ACCEPTED');
        await audit(q, 'risk', risk.id, 'QUOTED', 'BOUND');
        await enqueueEvent(q, 'PolicyBound', {
          policyId: id,
          policyRef,
          quoteId: quote.id,
          totalPremiumCents: total,
        });
        return id;
      });
      res.status(201).json(await loadPolicy(db, policyId));
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ApiError(409, 'quote_not_bindable', 'Quote already bound');
      throw e;
    }
  });

  app.get('/policies', async (_req, res) => {
    const { rows } = await db.query('SELECT id FROM policies ORDER BY bound_at DESC LIMIT 100');
    res.json(await Promise.all(rows.map((r: any) => loadPolicy(db, r.id))));
  });

  app.get('/policies/:id', async (req, res) => {
    z.uuid().parse(req.params.id);
    const policy = await loadPolicy(db, req.params.id);
    if (!policy) throw new ApiError(404, 'policy_not_found', 'Policy not found');
    res.json(policy);
  });

  finish();
  return app;
}
