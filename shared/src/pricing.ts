import { ValidationError } from './errors.js';

export type RiskType = 'marine_cargo' | 'commercial_property';

export const MIN_INSURED_VALUE_CENTS = 1_000_000; // 10,000.00
export const MAX_INSURED_VALUE_CENTS = 5_000_000_000; // 50,000,000.00
/** Risks at or above this value attract a large-risk loading. */
export const LARGE_RISK_THRESHOLD_CENTS = 100_000_000; // 1,000,000.00
export const LARGE_RISK_LOADING_BPS = 11_000; // x1.10

/** Base rate in basis points of insured value. */
export const BASE_RATE_BPS: Record<RiskType, number> = {
  marine_cargo: 80, // 0.80%
  commercial_property: 120, // 1.20%
};

export function isRiskType(v: unknown): v is RiskType {
  return v === 'marine_cargo' || v === 'commercial_property';
}

/**
 * premium = insuredValue * baseRate * loading, rounded half-up to the cent.
 * Integer/BigInt arithmetic only.
 *
 * PLANTED DEFECT DEF-004: the large-risk loading threshold uses `>` instead of `>=`,
 * so a risk of exactly 1,000,000.00 is under-charged. See docs/planted-defects.md.
 */
export function calculatePremiumCents(type: RiskType, insuredValueCents: number): number {
  if (!isRiskType(type)) throw new ValidationError(`Unknown risk type: ${String(type)}`);
  if (!Number.isInteger(insuredValueCents)) {
    throw new ValidationError('Insured value must be an integer number of cents');
  }
  if (insuredValueCents < MIN_INSURED_VALUE_CENTS || insuredValueCents > MAX_INSURED_VALUE_CENTS) {
    throw new ValidationError('Insured value is outside the underwriting appetite');
  }
  const loading = insuredValueCents > LARGE_RISK_THRESHOLD_CENTS ? LARGE_RISK_LOADING_BPS : 10_000;
  const numerator = BigInt(insuredValueCents) * BigInt(BASE_RATE_BPS[type]) * BigInt(loading);
  const denominator = 100_000_000n; // bps * bps
  return Number((2n * numerator + denominator) / (2n * denominator));
}
