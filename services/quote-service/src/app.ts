import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../../../shared/src/db.js';
import { ApiError } from '../../../shared/src/errors.js';
import { createBaseApp, isUniqueViolation } from '../../../shared/src/http.js';
import { audit } from '../../../shared/src/outbox.js';
import {
  MAX_INSURED_VALUE_CENTS,
  MIN_INSURED_VALUE_CENTS,
  calculatePremiumCents,
  type RiskType,
} from '../../../shared/src/pricing.js';

const brokerSchema = z.object({ name: z.string().min(1).max(120), email: z.email().max(200) });
const riskSchema = z.object({
  brokerId: z.uuid(),
  riskType: z.enum(['marine_cargo', 'commercial_property']),
  insuredValueCents: z.number().int().min(MIN_INSURED_VALUE_CENTS).max(MAX_INSURED_VALUE_CENTS),
  description: z.string().min(1).max(500),
});

const riskOut = (r: any) => ({
  id: r.id,
  brokerId: r.broker_id,
  riskType: r.risk_type,
  insuredValueCents: Number(r.insured_value_cents),
  currency: r.currency,
  description: r.description,
  status: r.status,
  createdAt: r.created_at,
});
const quoteOut = (q: any) => ({
  id: q.id,
  riskId: q.risk_id,
  premiumCents: Number(q.premium_cents),
  status: q.status,
  createdAt: q.created_at,
});

export function createQuoteApp(db: Db) {
  const { app, finish } = createBaseApp(
    'quote-service',
    new URL('../openapi.yaml', import.meta.url),
  );

  app.get('/brokers', async (_req, res) => {
    const { rows } = await db.query('SELECT id, name, email FROM brokers ORDER BY name LIMIT 200');
    res.json(rows);
  });

  app.post('/brokers', async (req, res) => {
    const body = brokerSchema.parse(req.body);
    try {
      const id = randomUUID();
      await db.query('INSERT INTO brokers (id, name, email) VALUES ($1,$2,$3)', [
        id,
        body.name,
        body.email,
      ]);
      res.status(201).json({ id, ...body });
    } catch (e) {
      if (isUniqueViolation(e))
        throw new ApiError(409, 'broker_exists', 'Broker email already exists');
      throw e;
    }
  });

  app.post('/risks', async (req, res) => {
    const body = riskSchema.parse(req.body);
    const broker = await db.query('SELECT id FROM brokers WHERE id = $1', [body.brokerId]);
    if (broker.rows.length === 0) throw new ApiError(404, 'broker_not_found', 'Broker not found');
    const id = randomUUID();
    const risk = await db.tx(async (q) => {
      const r = await q.query(
        `INSERT INTO risks (id, broker_id, risk_type, insured_value_cents, description, status)
         VALUES ($1,$2,$3,$4,$5,'SUBMITTED') RETURNING *`,
        [id, body.brokerId, body.riskType, body.insuredValueCents, body.description],
      );
      await audit(q, 'risk', id, null, 'SUBMITTED');
      return r.rows[0];
    });
    res.status(201).json(riskOut(risk));
  });

  app.get('/risks', async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const { rows } = await db.query(
      `SELECT * FROM risks WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 100`,
      [status],
    );
    res.json(rows.map(riskOut));
  });

  app.get('/risks/:id', async (req, res) => {
    z.uuid().parse(req.params.id);
    const { rows } = await db.query('SELECT * FROM risks WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new ApiError(404, 'risk_not_found', 'Risk not found');
    res.json(riskOut(rows[0]));
  });

  // Underwriter action: produce a quote for a submitted risk.
  app.post('/risks/:id/quote', async (req, res) => {
    z.uuid().parse(req.params.id);
    const quote = await db.tx(async (q) => {
      const r = await q.query('SELECT * FROM risks WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (r.rows.length === 0) throw new ApiError(404, 'risk_not_found', 'Risk not found');
      const risk = r.rows[0];
      if (risk.status !== 'SUBMITTED') {
        throw new ApiError(409, 'risk_not_quotable', `Risk is ${risk.status}, expected SUBMITTED`);
      }
      const premium = calculatePremiumCents(
        risk.risk_type as RiskType,
        Number(risk.insured_value_cents),
      );
      const quoteId = randomUUID();
      const ins = await q.query(
        `INSERT INTO quotes (id, risk_id, premium_cents, status) VALUES ($1,$2,$3,'QUOTED') RETURNING *`,
        [quoteId, risk.id, premium],
      );
      await q.query(`UPDATE risks SET status = 'QUOTED' WHERE id = $1`, [risk.id]);
      await audit(q, 'risk', risk.id, 'SUBMITTED', 'QUOTED');
      await audit(q, 'quote', quoteId, null, 'QUOTED');
      return ins.rows[0];
    });
    res.status(201).json(quoteOut(quote));
  });

  app.get('/quotes', async (req, res) => {
    const riskId = typeof req.query.riskId === 'string' ? req.query.riskId : null;
    if (riskId) z.uuid().parse(riskId);
    const { rows } = await db.query(
      `SELECT * FROM quotes WHERE ($1::uuid IS NULL OR risk_id = $1) ORDER BY created_at DESC LIMIT 100`,
      [riskId],
    );
    res.json(rows.map(quoteOut));
  });

  app.get('/quotes/:id', async (req, res) => {
    z.uuid().parse(req.params.id);
    const { rows } = await db.query('SELECT * FROM quotes WHERE id = $1', [req.params.id]);
    if (rows.length === 0) throw new ApiError(404, 'quote_not_found', 'Quote not found');
    res.json(quoteOut(rows[0]));
  });

  finish();
  return app;
}
