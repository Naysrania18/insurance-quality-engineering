import { describe, expect, it } from 'vitest';
import {
  LARGE_RISK_THRESHOLD_CENTS,
  MAX_INSURED_VALUE_CENTS,
  MIN_INSURED_VALUE_CENTS,
  calculatePremiumCents,
} from '../../shared/src/pricing.js';
import { formatMoney, toCents } from '../../shared/src/money.js';

describe('calculatePremiumCents', () => {
  it('applies the marine cargo base rate (0.80%)', () => {
    expect(calculatePremiumCents('marine_cargo', 50_000_00)).toBe(400_00);
  });

  it('applies the commercial property base rate (1.20%)', () => {
    expect(calculatePremiumCents('commercial_property', 50_000_00)).toBe(600_00);
  });

  it('rounds half-up to the nearest cent', () => {
    // 1,000,060 cents * 0.80% = 8000.48 -> 8000 ; 1,000,070 * 0.80% = 8000.56 -> 8001
    expect(calculatePremiumCents('marine_cargo', 1_000_060)).toBe(8_000);
    expect(calculatePremiumCents('marine_cargo', 1_000_070)).toBe(8_001);
  });

  it('rounds an exact half cent up', () => {
    // 1,000,125 cents * 1.20% = 12,001.5 cents -> 12,002
    expect(calculatePremiumCents('commercial_property', 1_000_125)).toBe(12_002);
  });

  describe('boundary values', () => {
    it('accepts the minimum insured value', () => {
      expect(calculatePremiumCents('marine_cargo', MIN_INSURED_VALUE_CENTS)).toBe(8_000);
    });

    it('rejects one cent below the minimum', () => {
      expect(() => calculatePremiumCents('marine_cargo', MIN_INSURED_VALUE_CENTS - 1)).toThrow(
        /appetite/,
      );
    });

    it('accepts the maximum insured value (with large-risk loading)', () => {
      // 50,000,000 * 0.8% * 1.10 = 440,000.00
      expect(calculatePremiumCents('marine_cargo', MAX_INSURED_VALUE_CENTS)).toBe(44_000_000);
    });

    it('rejects one cent above the maximum', () => {
      expect(() => calculatePremiumCents('marine_cargo', MAX_INSURED_VALUE_CENTS + 1)).toThrow(
        /appetite/,
      );
    });

    it('does not load a risk just below the threshold', () => {
      // 999,999.99 * 0.8% = 7,999.99992 -> 8,000.00 (no loading)
      expect(calculatePremiumCents('marine_cargo', LARGE_RISK_THRESHOLD_CENTS - 1)).toBe(800_000);
    });

    it('loads a risk just above the threshold', () => {
      // 1,000,000.01 * 0.8% * 1.1 = 8,800.000088 -> 8,800.00
      expect(calculatePremiumCents('marine_cargo', LARGE_RISK_THRESHOLD_CENTS + 1)).toBe(880_000);
    });

    // KNOWN DEFECT DEF-004 (docs/defects/DEF-004-large-risk-threshold.md): a risk of exactly
    // 1,000,000.00 should attract the loading ("at or above"), but the code uses ">".
    // Expected-to-fail test (`it.fails`): the suite goes red once the defect is fixed, which is
    // the cue to remove `.fails`.
    it.fails('DEF-004: loads a risk of exactly the threshold (at or above)', () => {
      expect(calculatePremiumCents('marine_cargo', LARGE_RISK_THRESHOLD_CENTS)).toBe(880_000);
    });
  });

  describe('input validation', () => {
    it('rejects non-integer cents', () => {
      expect(() => calculatePremiumCents('marine_cargo', 1_000_000.5)).toThrow(/integer/);
    });

    it('rejects an unknown risk type', () => {
      expect(() => calculatePremiumCents('cyber' as never, 2_000_000)).toThrow(/Unknown risk type/);
    });
  });

  it('is deterministic and monotonic in insured value (within a loading band)', () => {
    let previous = 0;
    for (let v = 1_000_000; v < LARGE_RISK_THRESHOLD_CENTS; v += 7_654_321) {
      const p = calculatePremiumCents('commercial_property', v);
      expect(p).toBeGreaterThanOrEqual(previous);
      previous = p;
    }
  });
});

describe('money helpers', () => {
  it('converts dollars to cents without float drift', () => {
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
  it('formats cents', () => {
    expect(formatMoney(123456)).toBe('1234.56 USD');
  });
});
