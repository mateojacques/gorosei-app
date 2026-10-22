import { type Rank, rankValue } from "./rank";

function averageRank(ranks: (Rank | null)[]): number {
  if (ranks.length === 0) return -1;
  return ranks.reduce((sum, r) => sum + (r ? rankValue(r) : 0), 0) / ranks.length;
}

export function seedOrder<T extends { id: string; ranks: (Rank | null)[]; registeredAt: Date }>(teams: T[]): T[] {
  return [...teams].sort(
    (a, b) =>
      averageRank(b.ranks) - averageRank(a.ranks) || a.registeredAt.getTime() - b.registeredAt.getTime(),
  );
}
