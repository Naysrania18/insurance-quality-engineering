import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PANEL,
  allocateShares,
  validatePanel,
  type PanelMember,
} from '../../shared/src/coinsurance.js';
import { splitPremium } from '../../services/policy-service/src/split.js';

const sum = (xs: { amountCents: number }[]) => xs.reduce((s, x) => s + x.amountCents, 0);

describe('allocateShares (largest remainder)', () => {
  it('splits evenly when divisible', () => {
    const out = allocateShares(10_000, [
      { insurer: 'A', bps: 5000 },
      { insurer: 'B', bps: 5000 },
    ]);
    expect(out.map((s) => s.amountCents)).toEqual([5000, 5000]);
  });

  it('allocates the odd cent to the largest remainder', () => {
    const out = allocateShares(1001, DEFAULT_PANEL);
    expect(sum(out)).toBe(1001);
  });

  it('always sums exactly to the total for a range of premiums', () => {
    for (let total = 0; total <= 5000; total += 1) {
      expect(sum(allocateShares(total, DEFAULT_PANEL))).toBe(total);
    }
  });

  it('handles a zero premium', () => {
    expect(sum(allocateShares(0, DEFAULT_PANEL))).toBe(0);
  });

  it('handles a single insurer holding 100%', () => {
    expect(allocateShares(12345, [{ insurer: 'Solo', bps: 10_000 }])).toEqual([
      { insurer: 'Solo', bps: 10_000, amountCents: 12345 },
    ]);
  });

  it('is stable on ties (earlier panel member wins the extra cent)', () => {
    const out = allocateShares(1, [
      { insurer: 'A', bps: 5000 },
      { insurer: 'B', bps: 5000 },
    ]);
    expect(out.map((s) => s.amountCents)).toEqual([1, 0]);
  });

  it('never gives any insurer more than 1 cent over its exact share', () => {
    const total = 987_654_321;
    for (const s of allocateShares(total, DEFAULT_PANEL)) {
      expect(Math.abs(s.amountCents - (total * s.bps) / 10_000)).toBeLessThan(1);
    }
  });

  it('handles very large premiums without overflow', () => {
    const total = 44_000_000;
    expect(sum(allocateShares(total, DEFAULT_PANEL))).toBe(total);
  });
});

describe('validatePanel', () => {
  const cases: [string, PanelMember[], RegExp][] = [
    ['empty panel', [], /empty/i],
    ['shares not totalling 100%', [{ insurer: 'A', bps: 9999 }], /100%/],
    ['shares over 100%', [{ insurer: 'A', bps: 6000 }, { insurer: 'B', bps: 5000 }], /100%/],
    ['duplicate insurer', [{ insurer: 'A', bps: 5000 }, { insurer: 'A', bps: 5000 }], /Duplicate/],
    ['zero share', [{ insurer: 'A', bps: 0 }, { insurer: 'B', bps: 10_000 }], /Invalid share/],
    ['fractional bps', [{ insurer: 'A', bps: 5000.5 }, { insurer: 'B', bps: 4999.5 }], /Invalid share/],
    ['blank insurer', [{ insurer: '', bps: 10_000 }], /name required/],
  ];
  it.each(cases)('rejects %s', (_name, panel, message) => {
    expect(() => validatePanel(panel)).toThrow(message);
  });

  it('accepts the default panel', () => {
    expect(() => validatePanel(DEFAULT_PANEL)).not.toThrow();
  });

  it('rejects negative totals in allocateShares', () => {
    expect(() => allocateShares(-1, DEFAULT_PANEL)).toThrow(/non-negative/);
  });
});

describe('policy-service splitPremium (the code path used when binding)', () => {
  // KNOWN DEFECT DEF-001 (docs/defects/DEF-001-share-rounding.md): independent rounding means shares
  // do not always add up to the premium. 1001 cents over 33.33/33.33/33.34 => 334+334+334 = 1002.
  it.fails('DEF-001: shares sum exactly to the premium', () => {
    expect(sum(splitPremium(1001, DEFAULT_PANEL))).toBe(1001);
  });

  it('documents the actual (defective) behaviour for 1001 cents', () => {
    expect(sum(splitPremium(1001, DEFAULT_PANEL))).toBe(1002);
  });
});
