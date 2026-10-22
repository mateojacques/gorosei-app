import { expect, test } from "bun:test";
import { planAutoPlacement } from "../../src/shared/auto-place";
import type { PoolCandidate } from "../../src/shared/auto-place";
import { evaluateEligibility } from "../../src/shared/eligibility";
import type { EligibilityRule } from "../../src/shared/eligibility";
import { ROLES } from "../../src/shared/pool";
import type { Role } from "../../src/shared/pool";
import type { Division, Tier } from "../../src/shared/rank";

const START = new Date("2026-10-20T12:00:00Z").getTime();

function cand(
  id: string,
  rank: `${Tier} ${Division}` | null,
  roles: Role[] = ["mid"],
  joinedAtOffset = 0,
): PoolCandidate {
  const [tier, division] = rank ? (rank.split(" ") as [Tier, Division]) : [];
  return {
    snapshot: {
      userId: id,
      riotId: `${id}#LAS`,
      rank: tier && division ? { tier, division, lp: 0 } : null,
      summonerLevel: 100,
      rankedGames: 50,
      takenAt: "2026-10-21T12:00:00.000Z",
    },
    roles,
    joinedAt: new Date(START + joinedAtOffset * 1000),
  };
}

const many = (n: number, rank: `${Tier} ${Division}` = "GOLD II") =>
  Array.from({ length: n }, (_, i) => cand(`p${String(i).padStart(2, "0")}`, rank, [ROLES[i % 5]!], i));

const NO_RULES = { rules: [] as EligibilityRule[], maxTeams: 16 };

test("13 candidates make 2 teams; the 3 latest joiners are unplaced", () => {
  const plan = planAutoPlacement(many(13), NO_RULES);
  expect(plan.teams).toHaveLength(2);
  expect(plan.unplacedUserIds).toEqual(["p10", "p11", "p12"]);
  const placed = plan.teams.flatMap((t) => t.members.map((m) => m.userId));
  expect(new Set(placed).size).toBe(10);
});

test("4 candidates form no teams and 0 candidates return empty", () => {
  expect(planAutoPlacement(many(4), NO_RULES)).toEqual({ teams: [], unplacedUserIds: ["p00", "p01", "p02", "p03"] });
  expect(planAutoPlacement([], NO_RULES)).toEqual({ teams: [], unplacedUserIds: [] });
});

test("maxTeams caps the result", () => {
  const one = planAutoPlacement(many(10), { rules: [], maxTeams: 1 });
  expect(one.teams).toHaveLength(1);
  expect(one.unplacedUserIds).toHaveLength(5);
  const none = planAutoPlacement(many(10), { rules: [], maxTeams: 0 });
  expect(none.teams).toEqual([]);
  expect(none.unplacedUserIds).toHaveLength(10);
});

test("each team has five distinct assigned roles and preferences are honored when possible", () => {
  const plan = planAutoPlacement(many(10), NO_RULES);
  expect(plan.teams).toHaveLength(2);
  const candidates = new Map(many(10).map((c) => [c.snapshot.userId, c]));
  for (const team of plan.teams) {
    expect(team.members).toHaveLength(5);
    expect(new Set(team.members.map((m) => m.role)).size).toBe(5);
    for (const member of team.members) expect(member.role).toBe(candidates.get(member.userId)!.roles[0]!);
  }
});

test("everyone listing only mid still forms two teams with distinct roles", () => {
  const all = Array.from({ length: 10 }, (_, i) => cand(`m${i}`, "GOLD II", ["mid"], i));
  const plan = planAutoPlacement(all, NO_RULES);
  expect(plan.teams).toHaveLength(2);
  for (const team of plan.teams) expect(new Set(team.members.map((m) => m.role)).size).toBe(5);
});

test("the highest-ranked player is captain; ties go to the earliest joiner", () => {
  const players = [
    cand("low1", "GOLD IV", ["top"], 0),
    cand("low2", "GOLD IV", ["jungle"], 1),
    cand("star", "PLATINUM I", ["mid"], 2),
    cand("low3", "GOLD IV", ["bot"], 3),
    cand("low4", "GOLD IV", ["support"], 4),
  ];
  expect(planAutoPlacement(players, NO_RULES).teams[0]!.captainUserId).toBe("star");
  const tie = players.map((p) => ({ ...p, snapshot: { ...p.snapshot, rank: { tier: "GOLD" as const, division: "IV" as const, lp: 0 } } }));
  expect(planAutoPlacement(tie, NO_RULES).teams[0]!.captainUserId).toBe("low1");
});

test("ranks are balanced across teams so the rules hold", () => {
  const rules: EligibilityRule[] = [{ id: "above", type: "max_players_above", count: 2, above: { tier: "EMERALD", division: "I" } }];
  const players = [
    ...Array.from({ length: 4 }, (_, i) => cand(`d${i}`, "DIAMOND II", [ROLES[i]!], i)),
    ...Array.from({ length: 6 }, (_, i) => cand(`g${i}`, "GOLD II", [ROLES[i % 5]!], 10 + i)),
  ];
  const plan = planAutoPlacement(players, { rules, maxTeams: 16 });
  expect(plan.teams).toHaveLength(2);
  const byId = new Map(players.map((p) => [p.snapshot.userId, p]));
  for (const team of plan.teams) {
    const roster = team.members.map((m) => ({ ...byId.get(m.userId)!.snapshot, isSub: false }));
    expect(evaluateEligibility(rules, roster, { subsCountForTeamRules: false, exemptRuleIds: [] })).toEqual([]);
    expect(team.members.filter((m) => m.userId.startsWith("d"))).toHaveLength(2);
  }
});

test("never returns a team that fails the rules", () => {
  const rules: EligibilityRule[] = [{ id: "above", type: "max_players_above", count: 0, above: { tier: "GOLD", division: "I" } }];
  const masters = Array.from({ length: 5 }, (_, i) => cand(`m${i}`, "MASTER I", [ROLES[i]!], i));
  const golds = Array.from({ length: 5 }, (_, i) => cand(`g${i}`, "GOLD I", [ROLES[i]!], 10 + i));
  const plan = planAutoPlacement([...masters, ...golds], { rules, maxTeams: 16 });
  expect(plan.teams).toHaveLength(1);
  expect(plan.teams[0]!.members.map((m) => m.userId).sort()).toEqual(["g0", "g1", "g2", "g3", "g4"]);
  expect(plan.unplacedUserIds).toEqual(["m0", "m1", "m2", "m3", "m4"]);

  const tenMasters = Array.from({ length: 10 }, (_, i) => cand(`x${i}`, "MASTER I", [ROLES[i % 5]!], i));
  expect(planAutoPlacement(tenMasters, { rules, maxTeams: 16 }).teams).toEqual([]);
});

test("is deterministic regardless of input order", () => {
  const players = [
    ...Array.from({ length: 4 }, (_, i) => cand(`d${i}`, "DIAMOND II", [ROLES[i]!, "mid"], i)),
    ...Array.from({ length: 8 }, (_, i) => cand(`g${i}`, i % 2 ? "GOLD II" : "SILVER I", [ROLES[(i + 2) % 5]!], 10 + i)),
  ];
  const shuffled = [...players].reverse().sort((a, b) => a.snapshot.userId.charCodeAt(1) % 3 - b.snapshot.userId.charCodeAt(1) % 3);
  const rules: EligibilityRule[] = [{ id: "above", type: "max_players_above", count: 2, above: { tier: "EMERALD", division: "I" } }];
  expect(planAutoPlacement(shuffled, { rules, maxTeams: 16 })).toEqual(planAutoPlacement(players, { rules, maxTeams: 16 }));
});
