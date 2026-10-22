import { eq, inArray } from "drizzle-orm";
import type { BracketSlot, BracketViewMatch } from "../../shared/bracket-layout";
import { type MatchStatus, bestOfFor } from "../../shared/match";
import type { Db } from "../db/client";
import { brackets, matches, registrations, teams, tournaments } from "../db/schema";
import { listEngineMatches } from "./engine";

const ENGINE_STATUS: Record<"locked" | "waiting" | "ready" | "running" | "completed", MatchStatus> = {
  locked: "waiting",
  waiting: "waiting",
  ready: "open",
  running: "open",
  completed: "completed",
};

/**
 * The public bracket: every engine match laid against its `matches` row. Byes (archived with one team) are kept
 * with no match id; archived matches with no team (bye against bye, a moot reset) are dropped.
 */
export async function getBracketView(
  db: Db,
  tournamentId: string,
): Promise<{ bracket: "double_elimination" | "single_elimination"; matches: BracketViewMatch[] } | null> {
  const [row] = await db
    .select({ data: brackets.data, type: tournaments.bracket, bestOf: tournaments.bestOf, finalsBestOf: tournaments.finalsBestOf })
    .from(brackets)
    .innerJoin(tournaments, eq(tournaments.id, brackets.tournamentId))
    .where(eq(brackets.tournamentId, tournamentId));
  if (!row) return null;
  const engine = listEngineMatches(row.data);
  const raw = new Map(row.data.match.map((m) => [Number(m.id), m]));
  // Participants are inserted in seed order, and each participant's name is its registration id.
  const seeds = new Map(row.data.participant.map((p, i) => [p.name, i + 1]));
  const stored = new Map((await db.select().from(matches).where(eq(matches.tournamentId, tournamentId))).map((m) => [m.bmMatchId, m]));
  const regIds = [...seeds.keys()];
  const names = new Map(
    regIds.length === 0
      ? []
      : (
          await db
            .select({ id: registrations.id, name: teams.name })
            .from(registrations)
            .innerJoin(teams, eq(teams.id, registrations.teamId))
            .where(inArray(registrations.id, regIds))
        ).map((r) => [r.id, r.name]),
  );

  const slot = (registrationId: string | null, score: number | null, winner: string | null): BracketSlot => ({
    registrationId,
    name: registrationId ? (names.get(registrationId) ?? null) : null,
    seed: registrationId ? (seeds.get(registrationId) ?? null) : null,
    score: registrationId ? score : null,
    winner: registrationId !== null && registrationId === winner,
  });

  const view: BracketViewMatch[] = [];
  for (const m of engine) {
    const teamCount = (m.team1 ? 1 : 0) + (m.team2 ? 1 : 0);
    const rawMatch = raw.get(m.id);
    const bye = rawMatch ? rawMatch.opponent1 === null || rawMatch.opponent2 === null : false;
    if (m.status === "archived" && !(bye && teamCount === 1)) continue;
    const match = stored.get(m.id);
    const completed = m.status === "completed";
    view.push({
      matchId: m.status === "archived" || teamCount === 0 ? null : (match?.id ?? null),
      phase: m.phase,
      round: m.round,
      number: m.number,
      bye: m.status === "archived",
      status: m.status === "archived" ? "completed" : (match?.status ?? ENGINE_STATUS[m.status]),
      bestOf: match?.bestOf ?? bestOfFor(row, m.phase),
      slots: [
        slot(m.team1, completed ? m.score1 : null, completed ? m.winner : null),
        slot(m.team2, completed ? m.score2 : null, completed ? m.winner : null),
      ],
    });
  }
  return { bracket: row.type, matches: view };
}
