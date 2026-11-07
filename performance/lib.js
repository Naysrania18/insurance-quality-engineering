// Shared helpers for the k6 scripts. k6 runs plain JavaScript (ES modules), not TypeScript.
import http from 'k6/http';
import { check } from 'k6';

export const QUOTE = __ENV.QUOTE_URL || 'http://localhost:3001';
export const POLICY = __ENV.POLICY_URL || 'http://localhost:3002';
export const CLAIMS = __ENV.CLAIMS_URL || 'http://localhost:3003';
// SCALE < 1 shortens every stage (CI uses a short run); 1 is the full profile.
export const SCALE = Number(__ENV.SCALE || 1);
export const stage = (seconds, target) => ({
  duration: `${Math.max(1, Math.round(seconds * SCALE))}s`,
  target,
});

const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };
const post = (url, body) => http.post(url, body ? JSON.stringify(body) : null, JSON_HEADERS);

/** Create a policy once, share it with all virtual users. */
export function setupPolicy() {
  const brokers = http.get(`${QUOTE}/brokers`).json();
  const risk = post(`${QUOTE}/risks`, {
    brokerId: brokers[0].id,
    riskType: 'commercial_property',
    insuredValueCents: 5_000_000_00,
    description: 'k6 load test policy',
  }).json();
  const quote = post(`${QUOTE}/risks/${risk.id}/quote`).json();
  const policy = post(`${POLICY}/policies`, { quoteId: quote.id }).json();
  return { brokerId: brokers[0].id, policyId: policy.id };
}

export function quoteJourney(data) {
  const value = 10_000_00 + Math.floor(Math.random() * 4_000_000_00);
  const r = post(`${QUOTE}/risks`, {
    brokerId: data.brokerId,
    riskType: Math.random() < 0.5 ? 'marine_cargo' : 'commercial_property',
    insuredValueCents: value,
    description: `k6 risk ${__VU}-${__ITER}`,
  });
  check(r, { 'risk created (201)': (res) => res.status === 201 });
  if (r.status !== 201) return;
  const q = post(`${QUOTE}/risks/${r.json().id}/quote`);
  check(q, {
    'quote created (201)': (res) => res.status === 201,
    'premium is positive': (res) => res.json().premiumCents > 0,
  });
}

export function claimJourney(data) {
  // vary the loss date + amount so requests are distinct claims (all dates are in the past)
  const day = String(1 + Math.floor(Math.random() * 27)).padStart(2, '0');
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, '0');
  const n = post(`${CLAIMS}/claims`, {
    policyId: data.policyId,
    lossDate: `2025-${month}-${day}`,
    amountClaimedCents: 1_000_00 + Math.floor(Math.random() * 100_000_00),
    description: `k6 claim ${__VU}-${__ITER}`,
  });
  check(n, { 'claim notified (201)': (res) => res.status === 201 });
  if (n.status !== 201) return;
  const claim = n.json();
  const a = post(`${CLAIMS}/claims/${claim.id}/assess`, {
    assessedCents: claim.amountClaimedCents,
  });
  check(a, { 'claim assessed (200)': (res) => res.status === 200 });
}
