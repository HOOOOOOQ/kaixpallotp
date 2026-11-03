// All amounts are integer minor units represented by bigint, never JavaScript Number.
export function applyWalletDelta(balance, delta) {
  for (const value of [balance.available, balance.reserved, delta.available, delta.reserved]) {
    if (typeof value !== 'bigint') throw new TypeError('Amounts must be bigint minor units');
  }
  if (balance.available < 0n || balance.reserved < 0n) throw new RangeError('Invalid starting balance');
  const result = { available: balance.available + delta.available, reserved: balance.reserved + delta.reserved };
  if (result.available < 0n || result.reserved < 0n) throw new RangeError('Insufficient balance');
  // Signed BIGINT storage limit; the database must make the same checks in a locked transaction.
  const max = 9223372036854775807n;
  if (result.available > max || result.reserved > max) throw new RangeError('Balance exceeds storage limit');
  return result;
}
