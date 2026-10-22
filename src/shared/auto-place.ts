import { evaluateEligibility } from "./eligibility";
import type { EligibilityRule, PlayerSnapshot } from "./eligibility";
import { ROLES } from "./pool";
import type { Role } from "./pool";
import { rankValue } from "./rank";
import { ROSTER_STARTERS } from "./tournament";

export type PoolCandidate = { snapshot: PlayerSnapshot; roles: Role[]; joinedAt: Date };
export type PlannedTeam = { captainUserId: string; members: { userId: string; role: Role }[] };

type Options = { rules: EligibilityRule[]; maxTeams: number };

/** Index of the role in the player's preference list; a role they did not list costs a full list length. */
const NOT_LISTED = ROLES.length;
const MAX_SWAP_PASSES = 50;

const value = (c: PoolCandidate) => (c.snapshot.rank === null ? 0 : rankValue(c.snapshot.rank));
const byJoin = (a: PoolCandidate, b: PoolCandidate) =>
  a.joinedAt.getTime() - b.joinedAt.getTime() || a.snapshot.userId.localeCompare(b.snapshot.userId);
const byRankDesc = (a: PoolCandidate, b: PoolCandidate) => value(b) - value(a) || byJoin(a, b);

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}
const ROLE_PERMUTATIONS = permutations(ROLES);

const roleCost = (c: PoolCandidate, role: Role) => {
  const i = c.roles.indexOf(role);
  return i === -1 ? NOT_LISTED : i;
};

/** The cheapest assignment of the five roles to the five players; ties resolve to the first permutation found. */
function assignRoles(team: PoolCandidate[]): { roles: Role[]; cost: number } {
  let best: { roles: Role[]; cost: number } | null = null;
  for (const perm of ROLE_PERMUTATIONS) {
    const cost = team.reduce((sum, c, i) => sum + roleCost(c, perm[i]!), 0);
    if (!best || cost < best.cost) best = { roles: perm, cost };
  }
  return best!;
}

function failureCount(team: PoolCandidate[], rules: EligibilityRule[]): number {
  const roster = team.map((c) => ({ ...c.snapshot, isSub: false }));
  return evaluateEligibility(rules, roster, { subsCountForTeamRules: false, exemptRuleIds: [] }).length;
}

type TeamScore = { failures: number; cost: number; average: number };
const scoreTeam = (team: PoolCandidate[], rules: EligibilityRule[]): TeamScore => ({
  failures: failureCount(team, rules),
  cost: assignRoles(team).cost,
  average: team.reduce((sum, c) => sum + value(c), 0) / team.length,
});

/** Lexicographic: rule failures, then total role cost, then the spread of the team rank averages. */
function objective(scores: TeamScore[]): [number, number, number] {
  const averages = scores.map((s) => s.average);
  return [
    scores.reduce((sum, s) => sum + s.failures, 0),
    scores.reduce((sum, s) => sum + s.cost, 0),
    Math.max(...averages) - Math.min(...averages),
  ];
}

function better(a: [number, number, number], b: [number, number, number]): boolean {
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) < 1e-9) continue;
    return a[i]! < b[i]!;
  }
  return false;
}

/** Strongest first, dealt back and forth so every team gets a similar rank average. */
function snakeDistribute(selected: PoolCandidate[], teamCount: number): PoolCandidate[][] {
  const teams: PoolCandidate[][] = Array.from({ length: teamCount }, () => []);
  [...selected].sort(byRankDesc).forEach((c, i) => {
    const row = Math.floor(i / teamCount);
    const column = i % teamCount;
    teams[row % 2 === 0 ? column : teamCount - 1 - column]!.push(c);
  });
  return teams;
}

function improveBySwaps(teams: PoolCandidate[][], rules: EligibilityRule[]): void {
  const scores = teams.map((team) => scoreTeam(team, rules));
  let current = objective(scores);
  for (let pass = 0; pass < MAX_SWAP_PASSES; pass++) {
    let improved = false;
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        for (let a = 0; a < ROSTER_STARTERS; a++) {
          for (let b = 0; b < ROSTER_STARTERS; b++) {
            const [ti, tj] = [teams[i]!, teams[j]!];
            [ti[a], tj[b]] = [tj[b]!, ti[a]!];
            const [si, sj] = [scores[i]!, scores[j]!];
            scores[i] = scoreTeam(ti, rules);
            scores[j] = scoreTeam(tj, rules);
            const next = objective(scores);
            if (better(next, current)) {
              current = next;
              improved = true;
            } else {
              [ti[a], tj[b]] = [tj[b]!, ti[a]!];
              scores[i] = si;
              scores[j] = sj;
            }
          }
        }
      }
    }
    if (!improved) return;
  }
}

function formTeams(selected: PoolCandidate[], teamCount: number, rules: EligibilityRule[]): PoolCandidate[][] | null {
  const teams = snakeDistribute(selected, teamCount);
  improveBySwaps(teams, rules);
  return teams.every((team) => failureCount(team, rules) === 0) ? teams : null;
}

function toPlanned(team: PoolCandidate[]): PlannedTeam {
  const { roles } = assignRoles(team);
  const captain = [...team].sort(byRankDesc)[0]!;
  const members = team
    .map((c, i) => ({ userId: c.snapshot.userId, role: roles[i]! }))
    .sort((a, b) => ROLES.indexOf(a.role) - ROLES.indexOf(b.role));
  return { captainUserId: captain.snapshot.userId, members };
}

/**
 * Forms teams of five from the candidates, never more than `maxTeams`. It tries the most teams first, picking the
 * earliest joiners (then, when that mix cannot satisfy the rules, the lowest-ranked players), and only returns teams
 * that pass the rules. Pure and deterministic: input order does not matter.
 */
export function planAutoPlacement(
  candidates: PoolCandidate[],
  options: Options,
): { teams: PlannedTeam[]; unplacedUserIds: string[] } {
  const ordered = [...candidates].sort(byJoin);
  const maxTeamCount = Math.max(0, Math.min(Math.floor(ordered.length / ROSTER_STARTERS), options.maxTeams));
  for (let k = maxTeamCount; k >= 1; k--) {
    const size = k * ROSTER_STARTERS;
    const attempts = [ordered.slice(0, size), [...ordered].sort((a, b) => value(a) - value(b) || byJoin(a, b)).slice(0, size)];
    for (const selected of attempts) {
      const teams = formTeams(selected, k, options.rules);
      if (!teams) continue;
      const placed = new Set(teams.flat().map((c) => c.snapshot.userId));
      const earliest = (team: PlannedTeam) => Math.min(...team.members.map((m) => ordered.findIndex((c) => c.snapshot.userId === m.userId)));
      return {
        teams: teams.map(toPlanned).sort((a, b) => earliest(a) - earliest(b)),
        unplacedUserIds: ordered.filter((c) => !placed.has(c.snapshot.userId)).map((c) => c.snapshot.userId),
      };
    }
  }
  return { teams: [], unplacedUserIds: ordered.map((c) => c.snapshot.userId) };
}
