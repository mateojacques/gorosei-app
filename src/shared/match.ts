import { z } from "zod";

export const MATCH_STATUSES = ["waiting", "open", "in_progress", "reported", "disputed", "completed"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export type MatchPhase = "winners" | "losers" | "grand_final" | "reset" | "main" | "final" | "third_place";

type BestOf = 1 | 3 | 5;

export const RIOT_MATCH_ID = /^LA2_\d+$/;

export const reportInputSchema = z.object({
  own: z.number().int().min(0).max(3),
  opponent: z.number().int().min(0).max(3),
  screenshotUrl: z.url({ protocol: /^https$/ }).max(500).nullable(),
  riotMatchIds: z.array(z.string().regex(RIOT_MATCH_ID)).max(3),
});
export type ReportInput = z.infer<typeof reportInputSchema>;

export function validateScore(bestOf: BestOf, a: number, b: number): boolean {
  const needed = Math.ceil(bestOf / 2);
  return Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b >= 0 && Math.max(a, b) === needed && Math.min(a, b) < needed;
}

export function bestOfFor(t: { bestOf: BestOf; finalsBestOf: BestOf }, phase: MatchPhase): BestOf {
  return phase === "grand_final" || phase === "reset" || phase === "final" ? t.finalsBestOf : t.bestOf;
}

const EXPECTED_MINUTES: Record<BestOf, number> = { 1: 45, 3: 75, 5: 105 };
const DELAY_GRACE_MINUTES = 15;

export function expectedMatchMinutes(bestOf: BestOf): number {
  return EXPECTED_MINUTES[bestOf];
}

export function isDelayed(openedAt: Date | null, bestOf: BestOf, now: Date): boolean {
  if (!openedAt) return false;
  return now.getTime() - openedAt.getTime() > (EXPECTED_MINUTES[bestOf] + DELAY_GRACE_MINUTES) * 60_000;
}
