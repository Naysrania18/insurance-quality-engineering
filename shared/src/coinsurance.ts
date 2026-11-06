import { ValidationError } from './errors.js';

export interface PanelMember {
  insurer: string;
  /** Share in basis points (10000 = 100%). */
  bps: number;
}

export interface InsurerShare extends PanelMember {
  amountCents: number;
}

/** Default panel; deliberately an uneven 3-way split so rounding matters. */
export const DEFAULT_PANEL: PanelMember[] = [
  { insurer: 'Alder Mutual', bps: 3333 },
  { insurer: 'Beacon Reinsurance', bps: 3333 },
  { insurer: 'Cobalt Underwriters', bps: 3334 },
];

export function validatePanel(panel: PanelMember[]): void {
  if (!Array.isArray(panel) || panel.length === 0) throw new ValidationError('Panel is empty');
  const names = new Set<string>();
  let total = 0;
  for (const m of panel) {
    if (!m.insurer) throw new ValidationError('Insurer name required');
    if (names.has(m.insurer)) throw new ValidationError(`Duplicate insurer: ${m.insurer}`);
    names.add(m.insurer);
    if (!Number.isInteger(m.bps) || m.bps <= 0) {
      throw new ValidationError(`Invalid share for ${m.insurer}`);
    }
    total += m.bps;
  }
  if (total !== 10_000) throw new ValidationError(`Shares must total 100% (got ${total / 100}%)`);
}

/**
 * Split a premium across the panel using the largest-remainder method so the
 * allocated amounts always sum exactly to the total.
 */
export function allocateShares(totalCents: number, panel: PanelMember[]): InsurerShare[] {
  validatePanel(panel);
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new ValidationError('Total must be a non-negative integer number of cents');
  }
  const rows = panel.map((m, index) => {
    const exact = BigInt(totalCents) * BigInt(m.bps);
    return {
      index,
      m,
      floor: Number(exact / 10_000n),
      remainder: Number(exact % 10_000n),
    };
  });
  let leftover = totalCents - rows.reduce((s, r) => s + r.floor, 0);
  const order = [...rows].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const r of order) {
    if (leftover <= 0) break;
    r.floor += 1;
    leftover -= 1;
  }
  return rows.map((r) => ({ ...r.m, amountCents: r.floor }));
}
