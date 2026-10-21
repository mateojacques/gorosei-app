import { t } from "./i18n";

export const TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const;
export const DIVISIONS = ["IV", "III", "II", "I"] as const;

export type Tier = (typeof TIERS)[number];
export type Division = (typeof DIVISIONS)[number];
export type Rank = { tier: Tier; division: Division; lp: number };

const APEX_TIERS: readonly Tier[] = ["MASTER", "GRANDMASTER", "CHALLENGER"];
const FIRST_APEX_VALUE = 28;

export function isApexTier(tier: Tier): boolean {
  return APEX_TIERS.includes(tier);
}

export function isTier(value: unknown): value is Tier {
  return TIERS.includes(value as Tier);
}

export function isDivision(value: unknown): value is Division {
  return DIVISIONS.includes(value as Division);
}

export function rankValue(r: Rank): number {
  if (isApexTier(r.tier)) return FIRST_APEX_VALUE + APEX_TIERS.indexOf(r.tier);
  return TIERS.indexOf(r.tier) * DIVISIONS.length + DIVISIONS.indexOf(r.division);
}

export function compareRanks(a: Rank | null, b: Rank | null): number {
  if (a === null || b === null) return (a === null ? 0 : 1) - (b === null ? 0 : 1);
  return rankValue(a) - rankValue(b) || a.lp - b.lp;
}

export function maxRank(ranks: (Rank | null)[]): Rank | null {
  return ranks.reduce<Rank | null>((best, r) => (compareRanks(r, best) > 0 ? r : best), null);
}

export function formatRank(r: Rank | null): string {
  if (r === null) return t("rank.unranked");
  const tier = t(`rank.tier.${r.tier}`);
  return isApexTier(r.tier) ? tier : `${tier} ${r.division}`;
}
