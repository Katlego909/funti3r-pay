/** Exact token amounts. Pure: no I/O, so any module (and any test) can use it as is. */

/** A token amount in its smallest unit: every Stellar asset has 7 decimal places. String math, so no float drift. */
export function toStroops(amount: string | number): bigint {
  const [whole, frac = ''] = String(amount).split('.');
  if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac) || frac.length > 7) {
    throw new Error(`Invalid amount: ${amount}`);
  }
  return BigInt(whole) * 10_000_000n + BigInt(frac.padEnd(7, '0') || '0');
}

/** The inverse of toStroops, as Horizon writes amounts ("12.5000000"). */
export function fromStroops(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, '0');
  return `${whole}.${frac}`;
}
