import type { InsurerShare, PanelMember } from '../../../shared/src/coinsurance.js';

/**
 * Splits a premium across the co-insurance panel.
 *
 * PLANTED DEFECT DEF-001: each share is rounded independently with Math.round, so the shares
 * can add up to +/- a few cents away from the premium. The shared `allocateShares` (largest
 * remainder) is correct and unit-tested, but is not what the bind path calls.
 * See docs/planted-defects.md and docs/defects/DEF-001-share-rounding.md.
 */
export function splitPremium(totalCents: number, panel: PanelMember[]): InsurerShare[] {
  return panel.map((m) => ({ ...m, amountCents: Math.round((totalCents * m.bps) / 10_000) }));
}
