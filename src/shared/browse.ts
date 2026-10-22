import { z } from "zod";
import type { EligibilityRule } from "./eligibility";
import { TIERS } from "./rank";
import type { Tier } from "./rank";
import type { TournamentStatus } from "./tournament";

export type RankBracket = Tier | "open";

export type BrowseTournament = {
  slug: string;
  title: string;
  edition: number;
  status: TournamentStatus;
  startsAt: Date;
  bracket: "double_elimination" | "single_elimination";
  entryFeeArs: number;
  prizeGoalArs: number;
  prizeSplit: number[];
  teamCap: number;
  confirmedCount: number;
  rankBracket: RankBracket;
};

export const FINISHED_LIMIT = 12;

export const RANK_BRACKETS = [...TIERS, "open"] as const;

export function rankBracketOf(rules: EligibilityRule[]): RankBracket {
  let lowest: number | null = null;
  for (const rule of rules) {
    if (rule.type !== "player_rank_range" || !rule.max) continue;
    const index = TIERS.indexOf(rule.max.tier);
    if (lowest === null || index < lowest) lowest = index;
  }
  return lowest === null ? "open" : TIERS[lowest]!;
}

export type BrowseSearch = {
  when?: "today" | "week" | "weekend";
  format?: BrowseTournament["bracket"];
  rank?: RankBracket;
};

// Unknown values in the query string are dropped, never an error: a stale shared link still shows the browse page.
export const browseSearchSchema: z.ZodType<BrowseSearch, unknown> = z
  .object({
    when: z.enum(["today", "week", "weekend"]).optional().catch(undefined),
    format: z.enum(["double_elimination", "single_elimination"]).optional().catch(undefined),
    rank: z.enum(RANK_BRACKETS).optional().catch(undefined),
  })
  .catch({})
  .transform((v) => {
    const out: BrowseSearch = {};
    if (v.when) out.when = v.when;
    if (v.format) out.format = v.format;
    if (v.rank) out.rank = v.rank;
    return out;
  });

// ART is a fixed UTC−03:00, so an ART calendar day is the UTC day of the instant shifted back three hours.
const ART_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;
const artDay = (d: Date) => Math.floor((d.getTime() - ART_OFFSET_MS) / DAY_MS);
const artWeekday = (d: Date) => new Date(d.getTime() - ART_OFFSET_MS).getUTCDay();

function dayRange(when: NonNullable<BrowseSearch["when"]>, now: Date): [number, number] {
  const today = artDay(now);
  if (when === "today") return [today, today];
  if (when === "week") return [today, today + 6];
  const weekday = artWeekday(now);
  if (weekday === 0) return [today, today];
  const saturday = today + (6 - weekday);
  return [saturday, saturday + 1];
}

export function filterTournaments<T extends Pick<BrowseTournament, "startsAt" | "bracket" | "rankBracket">>(
  list: T[],
  filters: BrowseSearch,
  now: Date,
): T[] {
  const range = filters.when ? dayRange(filters.when, now) : null;
  return list.filter((t) => {
    if (filters.format && t.bracket !== filters.format) return false;
    if (filters.rank && t.rankBracket !== filters.rank) return false;
    if (range) {
      const day = artDay(t.startsAt);
      if (day < range[0] || day > range[1]) return false;
    }
    return true;
  });
}

export function groupForBrowse<T extends Pick<BrowseTournament, "status" | "startsAt">>(
  list: T[],
  _now: Date,
): { upcoming: T[]; live: T[]; finished: T[] } {
  const byStart = (a: T, b: T) => a.startsAt.getTime() - b.startsAt.getTime();
  const upcoming = list
    .filter((t) => t.status === "registration_open" || t.status === "registration_closed" || t.status === "check_in")
    .sort(byStart);
  const live = list.filter((t) => t.status === "live").sort(byStart);
  const finished = list.filter((t) => t.status === "finished").sort((a, b) => byStart(b, a));
  return { upcoming, live, finished };
}
