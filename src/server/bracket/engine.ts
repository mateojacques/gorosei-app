import { BracketsManager } from "brackets-manager";
import { InMemoryDatabase } from "brackets-memory-db";
import { type Database, type Id, Status } from "brackets-model";
import type { MatchPhase } from "../../shared/match";

export type BracketData = Database;

export type EngineMatch = {
  id: number;
  group: number;
  round: number;
  number: number;
  phase: MatchPhase;
  status: "locked" | "waiting" | "ready" | "running" | "completed" | "archived";
  team1: string | null;
  team2: string | null;
  score1: number | null;
  score2: number | null;
  winner: string | null;
};

export class EngineError extends Error {
  constructor(
    readonly code: "next_match_started" | "invalid_match",
    message?: string,
  ) {
    super(message ?? code);
  }
}

const STATUS_NAMES: Record<number, EngineMatch["status"]> = {
  [Status.Locked]: "locked",
  [Status.Waiting]: "waiting",
  [Status.Ready]: "ready",
  [Status.Running]: "running",
  [Status.Completed]: "completed",
  [Status.Archived]: "archived",
};

function nextPowerOfTwo(n: number): number {
  let size = 2;
  while (size < n) size *= 2;
  return size;
}

async function managerFor(data: BracketData): Promise<BracketsManager> {
  const manager = new BracketsManager(new InMemoryDatabase());
  await manager.import(structuredClone(data), false);
  return manager;
}

export async function createBracket(
  type: "double_elimination" | "single_elimination",
  seeds: string[],
): Promise<{ data: BracketData; stageId: number }> {
  const manager = new BracketsManager(new InMemoryDatabase());
  const seeding: (string | null)[] = [...seeds];
  while (seeding.length < nextPowerOfTwo(seeds.length)) seeding.push(null);
  const stage = await manager.create.stage({
    tournamentId: 1,
    name: "main",
    type,
    seeding,
    settings:
      type === "double_elimination"
        ? { grandFinal: "double", seedOrdering: ["inner_outer"], balanceByes: true }
        : { consolationFinal: seeding.length >= 4, seedOrdering: ["inner_outer"], balanceByes: true },
  });
  return { data: await manager.export(), stageId: Number(stage.id) };
}

export function listEngineMatches(data: BracketData): EngineMatch[] {
  const names = new Map<Id, string>(data.participant.map((p) => [p.id, p.name]));
  const groups = new Map(data.group.map((g) => [g.id, g]));
  const rounds = new Map(data.round.map((r) => [r.id, r]));
  const stages = new Map(data.stage.map((s) => [s.id, s]));
  const lastRound = new Map<Id, number>();
  for (const r of data.round) lastRound.set(r.group_id, Math.max(lastRound.get(r.group_id) ?? 0, r.number));

  // brackets-manager leaves the reset match `ready` when the winners-bracket team takes grand final 1;
  // a reset match is moot (archived) in that case.
  const grandFinalWonByWinnersSide = new Set<Id>();
  for (const m of data.match) {
    const g = groups.get(m.group_id);
    const r = rounds.get(m.round_id);
    if (g && r && g.number === 3 && r.number === 1 && m.opponent1?.result === "win") grandFinalWonByWinnersSide.add(m.stage_id);
  }

  const name = (id: Id | null | undefined) => (id == null ? null : (names.get(id) ?? null));

  return data.match.map((m) => {
    const group = groups.get(m.group_id);
    const round = rounds.get(m.round_id);
    if (!group || !round) throw new EngineError("invalid_match");
    const double = stages.get(m.stage_id)?.type === "double_elimination";
    let phase: MatchPhase;
    if (double) {
      phase = group.number === 1 ? "winners" : group.number === 2 ? "losers" : round.number === 1 ? "grand_final" : "reset";
    } else if (group.number === 2) {
      phase = "third_place";
    } else {
      phase = round.number === lastRound.get(group.id) ? "final" : "main";
    }
    const bye = m.opponent1 === null || m.opponent2 === null;
    const moot = phase === "reset" && grandFinalWonByWinnersSide.has(m.stage_id);
    // The library archives played matches once the next round is done; only byes and moot resets are ours to hide.
    const libraryStatus = STATUS_NAMES[m.status] ?? "locked";
    const status = bye || moot ? "archived" : libraryStatus === "archived" ? "completed" : libraryStatus;
    const winner = m.opponent1?.result === "win" ? name(m.opponent1.id) : m.opponent2?.result === "win" ? name(m.opponent2.id) : null;
    return {
      id: Number(m.id),
      group: group.number,
      round: round.number,
      number: m.number,
      phase,
      status,
      team1: name(m.opponent1?.id),
      team2: name(m.opponent2?.id),
      score1: m.opponent1?.score ?? null,
      score2: m.opponent2?.score ?? null,
      winner: bye || moot ? null : winner,
    };
  });
}

export async function applyResult(
  data: BracketData,
  matchId: number,
  result: { score1: number; score2: number } | { forfeit: 1 | 2 },
): Promise<BracketData> {
  const manager = await managerFor(data);
  if ("forfeit" in result) {
    await manager.update.match({
      id: matchId,
      opponent1: { forfeit: result.forfeit === 1 },
      opponent2: { forfeit: result.forfeit === 2 },
    });
  } else {
    await manager.update.match({
      id: matchId,
      opponent1: { score: result.score1, result: result.score1 > result.score2 ? "win" : undefined },
      opponent2: { score: result.score2, result: result.score2 > result.score1 ? "win" : undefined },
    });
  }
  return manager.export();
}

export async function resetMatchResult(data: BracketData, matchId: number): Promise<BracketData> {
  const manager = await managerFor(data);
  try {
    await manager.reset.matchResults(matchId);
  } catch (error) {
    throw new EngineError("next_match_started", error instanceof Error ? error.message : undefined);
  }
  return manager.export();
}

export function bracketComplete(data: BracketData): boolean {
  return listEngineMatches(data).every((m) => m.status === "completed" || m.status === "archived");
}

export async function finalStandings(
  data: BracketData,
  stageId: number,
): Promise<{ registrationId: string; rank: number }[]> {
  const manager = await managerFor(data);
  const standings = await manager.get.finalStandings(stageId);
  return standings.map((s) => ({ registrationId: s.name, rank: s.rank }));
}
