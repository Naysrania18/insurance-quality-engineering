/** All money in the platform is stored as integer minor units (cents) to avoid float drift. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function formatMoney(cents: number, currency = 'USD'): string {
  return `${(cents / 100).toFixed(2)} ${currency}`;
}
