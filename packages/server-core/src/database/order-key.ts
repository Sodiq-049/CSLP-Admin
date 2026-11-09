/**
 * Fractional ordering keys (docs/02 §1). Keys are base-62 strings compared with plain
 * string comparison ("0-9A-Za-z" is ascending in ASCII). Moving an item rewrites one key.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`orderKey: ${a} >= ${b}`);
  if (a.endsWith('0') || (b !== null && b.endsWith('0')))
    throw new Error('orderKey: trailing zero');
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]!) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS[Math.round(0.5 * (digitA + digitB))]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), null);
}

/** A key strictly between `before` and `after` (either may be null = open end). */
export function orderKeyBetween(before: string | null, after: string | null): string {
  return midpoint(before ?? '', after);
}

/** `count` evenly spaced keys, for seeding or bulk imports. */
export function orderKeysBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  const keys: string[] = [];
  let prev = before;
  for (let i = 0; i < count; i++) {
    prev = orderKeyBetween(prev, after);
    keys.push(prev);
  }
  return keys;
}
