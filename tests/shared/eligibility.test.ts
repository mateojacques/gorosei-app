import { expect, test } from "bun:test";
import {
  describeRule,
  eligibilityRulesSchema,
  evaluateEligibility,
  formatFailure,
  type EligibilityRule,
  type RosterEntry,
  type RosterOptions,
} from "../../src/shared/eligibility";
import type { Division, Tier } from "../../src/shared/rank";

const OPTIONS: RosterOptions = { subsCountForTeamRules: false, exemptRuleIds: [] };

function player(
  userId: string,
  rank: `${Tier} ${Division}` | null,
  { level = 100, games = 50, isSub = false } = {},
): RosterEntry {
  const [tier, division] = rank ? (rank.split(" ") as [Tier, Division]) : [];
  return {
    userId,
    riotId: `${userId}#LAS`,
    rank: tier && division ? { tier, division, lp: 0 } : null,
    summonerLevel: level,
    rankedGames: games,
    takenAt: "2026-10-21T12:00:00.000Z",
    isSub,
  };
}

const maxDiamondIV: EligibilityRule = {
  id: "r1",
  type: "player_rank_range",
  max: { tier: "DIAMOND", division: "IV" },
};

function team(rank: `${Tier} ${Division}` | null, n: number): RosterEntry[] {
  return Array.from({ length: n }, (_, i) => player(`${rank ?? "UNR"}${i}`, rank));
}

test("rejects a player above the max rank", () => {
  expect(evaluateEligibility([maxDiamondIV], [player("u1", "DIAMOND III")], OPTIONS)).toMatchObject([
    { ruleId: "r1", userId: "u1", messageKey: "eligibility.fail.rank_above" },
  ]);
  expect(evaluateEligibility([maxDiamondIV], [player("u1", "DIAMOND IV")], OPTIONS)).toEqual([]);
});

test("unranked fails a minimum and passes a maximum", () => {
  const min: EligibilityRule = {
    id: "m",
    type: "player_rank_range",
    min: { tier: "IRON", division: "IV" },
  };
  expect(evaluateEligibility([min], [player("u1", null)], OPTIONS)).toMatchObject([
    { ruleId: "m", userId: "u1", messageKey: "eligibility.fail.rank_below" },
  ]);
  expect(evaluateEligibility([maxDiamondIV], [player("u1", null)], OPTIONS)).toEqual([]);
});

test("apex tiers are above any division cap", () => {
  const cap: EligibilityRule = {
    id: "c",
    type: "player_rank_range",
    max: { tier: "DIAMOND", division: "I" },
  };
  const master: RosterEntry = { ...player("u1", null), rank: { tier: "MASTER", division: "I", lp: 10 } };
  expect(evaluateEligibility([cap], [master], OPTIONS)).toHaveLength(1);
});

test("team average counts unranked as Iron IV", () => {
  const rule: EligibilityRule = { id: "a", type: "team_average_max", max: { tier: "GOLD", division: "IV" } };
  const failing = [...team("PLATINUM IV", 4), player("x", null)];
  expect(evaluateEligibility([rule], failing, OPTIONS)).toMatchObject([
    { ruleId: "a", messageKey: "eligibility.fail.team_average" },
  ]);
  const withIron = [...team("PLATINUM IV", 4), player("x", "IRON IV")];
  expect(evaluateEligibility([rule], withIron, OPTIONS)).toHaveLength(1);
  expect(evaluateEligibility([rule], [...team("GOLD IV", 4), player("x", null)], OPTIONS)).toEqual([]);
});

test("point budget sums starters only unless subs count", () => {
  const rule: EligibilityRule = {
    id: "b",
    type: "point_budget",
    points: { GOLD: 2, PLATINUM: 3 },
    unrankedPoints: 1,
    maxTotal: 12,
  };
  const starters = [...team("PLATINUM IV", 4), player("g", "GOLD II")];
  expect(evaluateEligibility([rule], starters, OPTIONS)).toEqual([
    { ruleId: "b", messageKey: "eligibility.fail.point_budget", params: { total: 14, max: 12 } },
  ]);
  const ok = [...team("GOLD IV", 5)];
  const sub = player("s", "PLATINUM IV", { isSub: true });
  expect(evaluateEligibility([rule], [...ok, sub], OPTIONS)).toEqual([]);
  expect(
    evaluateEligibility([rule], [...ok, sub], { ...OPTIONS, subsCountForTeamRules: true }),
  ).toMatchObject([{ params: { total: 13, max: 12 } }]);
});

test("point budget uses unrankedPoints for unranked and 0 for unlisted tiers", () => {
  const rule: EligibilityRule = {
    id: "b",
    type: "point_budget",
    points: { GOLD: 2 },
    unrankedPoints: 4,
    maxTotal: 5,
  };
  expect(evaluateEligibility([rule], [player("a", null), player("b", "SILVER I")], OPTIONS)).toEqual([]);
  expect(evaluateEligibility([rule], [player("a", null), player("b", "GOLD I")], OPTIONS)).toHaveLength(1);
});

test("max players above", () => {
  const rule: EligibilityRule = {
    id: "p",
    type: "max_players_above",
    count: 1,
    above: { tier: "EMERALD", division: "I" },
  };
  const roster = [player("a", "DIAMOND IV"), player("b", "DIAMOND IV"), player("c", "EMERALD I"), player("d", null)];
  const failures = evaluateEligibility([rule], roster, OPTIONS);
  expect(failures).toMatchObject([{ ruleId: "p", messageKey: "eligibility.fail.max_players_above" }]);
  expect(formatFailure(failures[0]!)).toBe(
    "Tu roster rompe una regla: máximo 1 jugador por encima de Esmeralda I.",
  );
  expect(evaluateEligibility([rule], [player("a", "DIAMOND IV"), player("c", "EMERALD I")], OPTIONS)).toEqual([]);
});

test("max players above pluralizes", () => {
  const f = {
    ruleId: "p",
    messageKey: "eligibility.fail.max_players_above" as const,
    params: { count: 2, rank: "Esmeralda I" },
  };
  expect(formatFailure(f)).toBe("Tu roster rompe una regla: máximo 2 jugadores por encima de Esmeralda I.");
});

test("account minimums check level and ranked games", () => {
  const rule: EligibilityRule = { id: "acc", type: "account_minimums", minLevel: 30, minRankedGames: 20 };
  const failures = evaluateEligibility(
    [rule],
    [player("a", "GOLD IV", { level: 10 }), player("b", "GOLD IV", { games: 5 }), player("c", "GOLD IV")],
    OPTIONS,
  );
  expect(failures).toMatchObject([
    { ruleId: "acc", userId: "a", messageKey: "eligibility.fail.min_level" },
    { ruleId: "acc", userId: "b", messageKey: "eligibility.fail.min_ranked_games" },
  ]);
  expect(formatFailure(failures[0]!)).toContain("a#LAS");
});

test("per-player rules apply to subs, team rules to starters", () => {
  const sub = player("s", "MASTER IV", { isSub: true });
  expect(evaluateEligibility([maxDiamondIV], [sub], OPTIONS)).toHaveLength(1);
  const avg: EligibilityRule = { id: "a", type: "team_average_max", max: { tier: "GOLD", division: "IV" } };
  expect(evaluateEligibility([avg], [sub], OPTIONS)).toEqual([]);
});

test("empty roster passes team rules", () => {
  const rules: EligibilityRule[] = [
    { id: "a", type: "team_average_max", max: { tier: "GOLD", division: "IV" } },
    { id: "b", type: "point_budget", points: {}, unrankedPoints: 1, maxTotal: 0 },
  ];
  expect(evaluateEligibility(rules, [], OPTIONS)).toEqual([]);
});

test("exempt rules are skipped", () => {
  expect(
    evaluateEligibility([maxDiamondIV], [player("u1", "MASTER IV")], { ...OPTIONS, exemptRuleIds: ["r1"] }),
  ).toEqual([]);
});

test("schema rejects duplicate rule ids and unknown types", () => {
  const rules: EligibilityRule[] = [
    maxDiamondIV,
    { id: "a", type: "team_average_max", max: { tier: "GOLD", division: "IV" } },
    { id: "b", type: "point_budget", points: { GOLD: 2 }, unrankedPoints: 1, maxTotal: 12 },
    { id: "p", type: "max_players_above", count: 1, above: { tier: "EMERALD", division: "I" } },
    { id: "acc", type: "account_minimums", minLevel: 30 },
  ];
  expect(eligibilityRulesSchema.safeParse(rules).success).toBe(true);
  expect(eligibilityRulesSchema.safeParse([maxDiamondIV, maxDiamondIV]).success).toBe(false);
  expect(eligibilityRulesSchema.safeParse([{ id: "x", type: "nope" }]).success).toBe(false);
});

test("describeRule", () => {
  expect(describeRule(maxDiamondIV)).toBe("Rango máximo por jugador: Diamante IV");
});
