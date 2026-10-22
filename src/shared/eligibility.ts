import { z } from "zod";
import { formatRank, rankValue, DIVISIONS, TIERS } from "./rank";
import type { Division, Rank, Tier } from "./rank";
import { t } from "./i18n";
import type { MessageKey } from "./i18n";

export type RankBound = { tier: Tier; division: Division };

export type EligibilityRule =
  | { id: string; type: "player_rank_range"; min?: RankBound; max?: RankBound }
  | { id: string; type: "team_average_max"; max: RankBound }
  | {
      id: string;
      type: "point_budget";
      points: Partial<Record<Tier, number>>;
      unrankedPoints: number;
      maxTotal: number;
    }
  | { id: string; type: "max_players_above"; count: number; above: RankBound }
  | { id: string; type: "account_minimums"; minLevel?: number; minRankedGames?: number };

const MAX_RULES = 20;

const rankBoundSchema = z.object({ tier: z.enum(TIERS), division: z.enum(DIVISIONS) });
const ruleId = z.string().min(1).max(40);
const points = z.number().int().min(0).max(1000);

const ruleSchema = z.discriminatedUnion("type", [
  z.object({
    id: ruleId,
    type: z.literal("player_rank_range"),
    min: rankBoundSchema.optional(),
    max: rankBoundSchema.optional(),
  }),
  z.object({ id: ruleId, type: z.literal("team_average_max"), max: rankBoundSchema }),
  z.object({
    id: ruleId,
    type: z.literal("point_budget"),
    points: z.partialRecord(z.enum(TIERS), points),
    unrankedPoints: points,
    maxTotal: points,
  }),
  z.object({
    id: ruleId,
    type: z.literal("max_players_above"),
    count: z.number().int().min(0).max(10),
    above: rankBoundSchema,
  }),
  z.object({
    id: ruleId,
    type: z.literal("account_minimums"),
    minLevel: z.number().int().min(0).max(10000).optional(),
    minRankedGames: z.number().int().min(0).max(100000).optional(),
  }),
]);

export const eligibilityRulesSchema: z.ZodType<EligibilityRule[]> = z
  .array(ruleSchema)
  .max(MAX_RULES)
  .refine((rules) => new Set(rules.map((r) => r.id)).size === rules.length, {
    message: "duplicate rule id",
  });

export type PlayerSnapshot = {
  userId: string;
  riotId: string;
  rank: Rank | null;
  summonerLevel: number;
  rankedGames: number;
  takenAt: string;
};
export type RosterEntry = PlayerSnapshot & { isSub: boolean };
export type RosterOptions = { subsCountForTeamRules: boolean; exemptRuleIds: readonly string[] };
export type EligibilityFailure = {
  ruleId: string;
  userId?: string;
  messageKey: MessageKey;
  params: Record<string, string | number>;
};

const boundValue = (b: RankBound) => rankValue({ ...b, lp: 0 });
const formatBound = (b: RankBound) => formatRank({ ...b, lp: 0 });
// Unranked counts as Iron IV (value 0) wherever a number is needed.
const playerValue = (r: Rank | null) => (r === null ? 0 : rankValue(r));

function playerFailures(rule: EligibilityRule, roster: RosterEntry[]): EligibilityFailure[] {
  const failures: EligibilityFailure[] = [];
  for (const p of roster) {
    const base = { ruleId: rule.id, userId: p.userId };
    const player = p.riotId;
    if (rule.type === "player_rank_range") {
      const rank = formatRank(p.rank);
      if (rule.min && (p.rank === null || rankValue(p.rank) < boundValue(rule.min))) {
        failures.push({
          ...base,
          messageKey: "eligibility.fail.rank_below",
          params: { player, rank, min: formatBound(rule.min) },
        });
      } else if (rule.max && p.rank !== null && rankValue(p.rank) > boundValue(rule.max)) {
        failures.push({
          ...base,
          messageKey: "eligibility.fail.rank_above",
          params: { player, rank, max: formatBound(rule.max) },
        });
      }
    } else if (rule.type === "account_minimums") {
      if (rule.minLevel !== undefined && p.summonerLevel < rule.minLevel) {
        failures.push({
          ...base,
          messageKey: "eligibility.fail.min_level",
          params: { player, level: p.summonerLevel, min: rule.minLevel },
        });
      }
      if (rule.minRankedGames !== undefined && p.rankedGames < rule.minRankedGames) {
        failures.push({
          ...base,
          messageKey: "eligibility.fail.min_ranked_games",
          params: { player, games: p.rankedGames, min: rule.minRankedGames },
        });
      }
    }
  }
  return failures;
}

function teamFailures(rule: EligibilityRule, team: RosterEntry[]): EligibilityFailure[] {
  if (team.length === 0) return [];
  if (rule.type === "team_average_max") {
    const average = team.reduce((sum, p) => sum + playerValue(p.rank), 0) / team.length;
    if (average <= boundValue(rule.max)) return [];
    return [
      {
        ruleId: rule.id,
        messageKey: "eligibility.fail.team_average",
        params: { average: average.toFixed(1), max: formatBound(rule.max) },
      },
    ];
  }
  if (rule.type === "point_budget") {
    const total = team.reduce(
      (sum, p) => sum + (p.rank === null ? rule.unrankedPoints : (rule.points[p.rank.tier] ?? 0)),
      0,
    );
    if (total <= rule.maxTotal) return [];
    return [
      {
        ruleId: rule.id,
        messageKey: "eligibility.fail.point_budget",
        params: { total, max: rule.maxTotal },
      },
    ];
  }
  if (rule.type === "max_players_above") {
    const limit = boundValue(rule.above);
    const above = team.filter((p) => p.rank !== null && rankValue(p.rank) > limit).length;
    if (above <= rule.count) return [];
    return [
      {
        ruleId: rule.id,
        messageKey: "eligibility.fail.max_players_above",
        params: { count: rule.count, rank: formatBound(rule.above) },
      },
    ];
  }
  return [];
}

export function evaluateEligibility(
  rules: EligibilityRule[],
  roster: RosterEntry[],
  options: RosterOptions,
): EligibilityFailure[] {
  const team = roster.filter((p) => !p.isSub || options.subsCountForTeamRules);
  return rules
    .filter((rule) => !options.exemptRuleIds.includes(rule.id))
    .flatMap((rule) => [...playerFailures(rule, roster), ...teamFailures(rule, team)]);
}

/** The rules that can be judged for one player alone; team rules wait for a roster. */
export function evaluatePlayerRules(rules: EligibilityRule[], player: PlayerSnapshot): EligibilityFailure[] {
  const entry: RosterEntry = { ...player, isSub: false };
  return rules.flatMap((rule) => playerFailures(rule, [entry]));
}

export function describeRule(rule: EligibilityRule): string {
  switch (rule.type) {
    case "player_rank_range": {
      const min = rule.min && formatBound(rule.min);
      const max = rule.max && formatBound(rule.max);
      if (min && max) return t("eligibility.describe.player_rank_range", { min, max });
      if (min) return t("eligibility.describe.player_rank_range_min", { min });
      if (max) return t("eligibility.describe.player_rank_range_max", { max });
      return "";
    }
    case "team_average_max":
      return t("eligibility.describe.team_average_max", { max: formatBound(rule.max) });
    case "point_budget":
      return t("eligibility.describe.point_budget", { max: rule.maxTotal });
    case "max_players_above":
      return t(
        rule.count === 1
          ? "eligibility.describe.max_players_above"
          : "eligibility.describe.max_players_above_other",
        { count: rule.count, rank: formatBound(rule.above) },
      );
    case "account_minimums": {
      const parts: string[] = [];
      if (rule.minLevel !== undefined) {
        parts.push(t("eligibility.describe.min_level", { level: rule.minLevel }));
      }
      if (rule.minRankedGames !== undefined) {
        parts.push(t("eligibility.describe.min_ranked_games", { games: rule.minRankedGames }));
      }
      return t("eligibility.describe.account_minimums", { parts: parts.join(", ") });
    }
  }
}

export function formatFailure(f: EligibilityFailure): string {
  const key =
    f.messageKey === "eligibility.fail.max_players_above" && f.params.count !== 1
      ? "eligibility.fail.max_players_above_other"
      : f.messageKey;
  return t(key, f.params);
}
