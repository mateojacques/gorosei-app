export function prizePoolArs(paidEntries: number, entryFeeArs: number): number {
  return paidEntries * entryFeeArs;
}

/** Floors each share; the remainder goes to first place. */
export function splitPrize(poolArs: number, split: number[]): number[] {
  const shares = split.map((pct) => Math.floor((poolArs * pct) / 100));
  const remainder = poolArs - shares.reduce((a, b) => a + b, 0);
  if (shares.length > 0) shares[0]! += remainder;
  return shares;
}
