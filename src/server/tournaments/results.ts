import { and, asc, eq, gt, inArray, ne } from "drizzle-orm";
import type { MatchPhase } from "../../shared/match";
import type { Db } from "../db/client";
import { brackets, registrations, teams, tournaments } from "../db/schema";

export type ResultTeam = { registrationId: string; teamName: string; teamSlug: string; tag: string };

export type TournamentResults = {
  champion: ResultTeam | null;
  podium: { rank: 1 | 2 | 3; team: ResultTeam; prizeArs: number | null }[];
  vods: { matchId: string; phase: MatchPhase; round: number; teams: [string, string]; url: string }[];
};

async function resultTeams(db: Db, registrationIds: string[]): Promise<Map<string, ResultTeam>> {
  if (registrationIds.length === 0) return new Map();
  const rows = await db
    .select({ registrationId: registrations.id, teamName: teams.name, teamSlug: teams.slug, tag: teams.tag })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(inArray(registrations.id, registrationIds));
  return new Map(rows.map((r) => [r.registrationId, r]));
}

/** Champion, podium and VODs of a finished tournament; null for any other status. Never invents a champion. */
export async function getTournamentResults(db: Db, tournamentId: string, prizeShares: number[]): Promise<TournamentResults | null> {
  const [tournament] = await db.select({ status: tournaments.status }).from(tournaments).where(eq(tournaments.id, tournamentId));
  if (tournament?.status !== "finished") return null;
  const [bracket] = await db.select({ standings: brackets.finalStandings }).from(brackets).where(eq(brackets.tournamentId, tournamentId));
  const top = (bracket?.standings ?? []).filter((s) => s.rank >= 1 && s.rank <= 3).sort((a, b) => a.rank - b.rank);
  const named = await resultTeams(db, top.map((s) => s.registrationId));
  const podium: TournamentResults["podium"] = [];
  for (const s of top) {
    const team = named.get(s.registrationId);
    if (team) podium.push({ rank: s.rank as 1 | 2 | 3, team, prizeArs: prizeShares[s.rank - 1] ?? null });
  }
  return { champion: podium.find((p) => p.rank === 1)?.team ?? null, podium, vods: [] };
}

export type NextCup = { slug: string; title: string; edition: number; startsAt: Date };

export async function getNextTournament(db: Db, current: { id: string; startsAt: Date }): Promise<NextCup | null> {
  const [next] = await db
    .select({ slug: tournaments.slug, title: tournaments.title, edition: tournaments.edition, startsAt: tournaments.startsAt })
    .from(tournaments)
    .where(
      and(
        inArray(tournaments.status, ["registration_open", "registration_closed", "check_in", "live"]),
        gt(tournaments.startsAt, current.startsAt),
        ne(tournaments.id, current.id),
      ),
    )
    .orderBy(asc(tournaments.startsAt))
    .limit(1);
  return next ?? null;
}
