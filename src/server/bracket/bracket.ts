import { and, asc, eq, inArray } from "drizzle-orm";
import { type MatchPhase, type MatchStatus, type UserRole, bestOfFor, isDelayed, isModerator } from "../../shared/match";
import { seedOrder } from "../../shared/seeding";
import type { Db, Executor } from "../db/client";
import { brackets, matchReports, matches, registrationPlayers, registrations, teams, tournaments } from "../db/schema";
import type { Tournament } from "../tournaments/tournaments";
import type { MatchStats } from "../matchday/stats";
import { createBracket, listEngineMatches } from "./engine";

/** Seeds the confirmed teams by average rank and stores the bracket; matches are mirrored by syncMatches. */
export async function startBracket(tx: Executor, tournament: Tournament, registrationIds: string[], now: Date): Promise<void> {
  const regs = await tx.select().from(registrations).where(inArray(registrations.id, registrationIds));
  const players = await tx
    .select()
    .from(registrationPlayers)
    .where(and(inArray(registrationPlayers.registrationId, registrationIds), eq(registrationPlayers.active, true)));
  const teams = regs.map((r) => ({
    id: r.id,
    registeredAt: r.createdAt,
    ranks: players.filter((p) => p.registrationId === r.id && !p.isSub).map((p) => p.snapshot.rank),
  }));
  const seeds = seedOrder(teams).map((t) => t.id);
  const { data, stageId } = await createBracket(tournament.bracket, seeds);
  await tx.insert(brackets).values({ tournamentId: tournament.id, data, stageId, updatedAt: now });
  await syncMatches(tx, tournament.id, now);
}

const IN_PLAY: MatchStatus[] = ["open", "in_progress", "reported", "disputed"];

/**
 * Rewrites the `matches` rows from the stored bracket. The bracket owns teams, scores and winners;
 * the match-day workflow states (in_progress, reported, disputed) are kept while a match is still being played.
 */
export async function syncMatches(tx: Executor, tournamentId: string, now: Date): Promise<void> {
  const [bracket] = await tx.select().from(brackets).where(eq(brackets.tournamentId, tournamentId)).for("update");
  if (!bracket) return;
  const [tournament] = await tx.query.tournaments.findMany({ where: (t, { eq }) => eq(t.id, tournamentId), limit: 1 });
  if (!tournament) return;
  const existing = new Map((await tx.select().from(matches).where(eq(matches.tournamentId, tournamentId))).map((m) => [m.bmMatchId, m]));

  for (const m of listEngineMatches(bracket.data)) {
    const previous = existing.get(m.id);
    if (m.status === "archived") {
      // A reset match that became moot (grand final won from the winners side) disappears.
      if (previous) await tx.delete(matches).where(eq(matches.id, previous.id));
      continue;
    }
    const reg1Id = m.team1;
    const reg2Id = m.team2;
    let status: MatchStatus;
    if (m.status === "completed") status = "completed";
    else if (m.status === "ready" || m.status === "running") {
      status = previous && IN_PLAY.includes(previous.status) ? previous.status : "open";
    } else status = "waiting";
    const becameOpen = status === "open" && previous?.status !== "open";
    const completed = status === "completed";
    const values = {
      tournamentId,
      bmMatchId: m.id,
      phase: m.phase,
      groupNo: m.group,
      roundNo: m.round,
      number: m.number,
      bestOf: bestOfFor(tournament, m.phase),
      reg1Id,
      reg2Id,
      status,
      score1: completed ? m.score1 : null,
      score2: completed ? m.score2 : null,
      winnerRegId: completed ? m.winner : null,
      ...(becameOpen ? { openedAt: now } : {}),
      ...(!completed && previous?.status === "completed" ? { confirmedBy: null, confirmedAt: null } : {}),
    };
    if (previous) await tx.update(matches).set(values).where(eq(matches.id, previous.id));
    else await tx.insert(matches).values({ ...values, openedAt: becameOpen ? now : null });
  }
}

export type MatchTeam = { registrationId: string; teamId: string; name: string; tag: string; slug: string };

export type MatchView = {
  id: string;
  tournamentId: string;
  phase: MatchPhase;
  round: number;
  number: number;
  bestOf: 1 | 3 | 5;
  status: MatchStatus;
  delayed: boolean;
  teams: [MatchTeam | null, MatchTeam | null];
  score: [number | null, number | null];
  winnerRegistrationId: string | null;
  reports: { registrationId: string; score1: number; score2: number; screenshotUrl: string | null }[];
  lobby: { name: string; password: string } | null;
  riotMatchIds: string[];
  stats: MatchStats[] | null;
};

async function loadTeams(tx: Executor, registrationIds: string[]): Promise<Map<string, MatchTeam>> {
  if (registrationIds.length === 0) return new Map();
  const rows = await tx
    .select({ registrationId: registrations.id, teamId: teams.id, name: teams.name, tag: teams.tag, slug: teams.slug })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(inArray(registrations.id, registrationIds));
  return new Map(rows.map((r) => [r.registrationId, r]));
}

/** Lobby and reports are private to the two teams and to moderators. */
export async function canSeeMatchPrivate(
  tx: Executor,
  match: { reg1Id: string | null; reg2Id: string | null },
  viewer: { userId: string; role: UserRole } | null,
): Promise<boolean> {
  if (!viewer) return false;
  if (isModerator(viewer.role)) return true;
  const ids = [match.reg1Id, match.reg2Id].filter((id): id is string => id !== null);
  if (ids.length === 0) return false;
  const [row] = await tx
    .select({ userId: registrationPlayers.userId })
    .from(registrationPlayers)
    .where(
      and(
        inArray(registrationPlayers.registrationId, ids),
        eq(registrationPlayers.userId, viewer.userId),
        eq(registrationPlayers.active, true),
      ),
    );
  return !!row;
}

export async function getMatchView(
  db: Db,
  matchId: string,
  viewer: { userId: string; role: UserRole } | null,
  now: Date,
): Promise<MatchView | null> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return null;
  const teamMap = await loadTeams(db, [match.reg1Id, match.reg2Id].filter((id): id is string => id !== null));
  const priv = await canSeeMatchPrivate(db, match, viewer);
  const reports = priv
    ? (await db.select().from(matchReports).where(eq(matchReports.matchId, matchId))).map((r) => ({
        registrationId: r.registrationId,
        score1: r.score1,
        score2: r.score2,
        screenshotUrl: r.screenshotUrl,
      }))
    : [];
  return {
    id: match.id,
    tournamentId: match.tournamentId,
    phase: match.phase,
    round: match.roundNo,
    number: match.number,
    bestOf: match.bestOf,
    status: match.status,
    delayed: match.status !== "completed" && match.status !== "waiting" && isDelayed(match.openedAt, match.bestOf, now),
    teams: [match.reg1Id ? (teamMap.get(match.reg1Id) ?? null) : null, match.reg2Id ? (teamMap.get(match.reg2Id) ?? null) : null],
    score: [match.score1, match.score2],
    winnerRegistrationId: match.winnerRegId,
    reports,
    lobby: priv && match.lobbyName !== null ? { name: match.lobbyName, password: match.lobbyPassword ?? "" } : null,
    riotMatchIds: match.riotMatchIds,
    stats: (match.stats as MatchStats[] | null) ?? null,
  };
}

export type MatchSummary = Pick<MatchView, "id" | "phase" | "round" | "number" | "bestOf" | "status" | "teams" | "score" | "winnerRegistrationId">;

export async function listMatches(db: Db, tournamentId: string): Promise<MatchSummary[]> {
  const rows = await db
    .select()
    .from(matches)
    .where(eq(matches.tournamentId, tournamentId))
    .orderBy(asc(matches.groupNo), asc(matches.roundNo), asc(matches.number));
  const teamMap = await loadTeams(db, [...new Set(rows.flatMap((m) => [m.reg1Id, m.reg2Id]).filter((id): id is string => id !== null))]);
  return rows.map((m) => ({
    id: m.id,
    phase: m.phase,
    round: m.roundNo,
    number: m.number,
    bestOf: m.bestOf,
    status: m.status,
    teams: [m.reg1Id ? (teamMap.get(m.reg1Id) ?? null) : null, m.reg2Id ? (teamMap.get(m.reg2Id) ?? null) : null],
    score: [m.score1, m.score2],
    winnerRegistrationId: m.winnerRegId,
  }));
}

export type ConsoleItem = {
  matchId: string;
  tournamentSlug: string;
  kind: "dispute" | "confirm" | "lobby" | "delayed";
  round: number;
  teams: [string, string];
  reportCount: number;
  since: Date;
};

const KIND_ORDER: Record<ConsoleItem["kind"], number> = { dispute: 0, confirm: 1, lobby: 2, delayed: 3 };

/** What needs a moderator: disputes first, then results to confirm, lobbies to create, then late matches; oldest first. */
export async function getConsoleQueue(db: Db, now: Date): Promise<ConsoleItem[]> {
  const rows = await db
    .select({ match: matches, slug: tournaments.slug })
    .from(matches)
    .innerJoin(tournaments, eq(tournaments.id, matches.tournamentId))
    .where(and(eq(tournaments.status, "live"), inArray(matches.status, ["open", "in_progress", "reported", "disputed"])));
  if (rows.length === 0) return [];
  const reports = await db
    .select()
    .from(matchReports)
    .where(inArray(matchReports.matchId, rows.map((r) => r.match.id)));
  const teamMap = await loadTeams(db, [...new Set(rows.flatMap((r) => [r.match.reg1Id, r.match.reg2Id]).filter((id): id is string => id !== null))]);

  const items: ConsoleItem[] = [];
  for (const { match, slug } of rows) {
    const mine = reports.filter((r) => r.matchId === match.id);
    const lastReport = mine.reduce<Date | null>((latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest), null);
    let kind: ConsoleItem["kind"] | null = null;
    if (match.status === "disputed") kind = "dispute";
    else if (match.status === "reported" || (match.status === "in_progress" && mine.length > 0)) kind = "confirm";
    else if (match.status === "open") kind = "lobby";
    else if (isDelayed(match.openedAt, match.bestOf, now)) kind = "delayed";
    if (!kind) continue;
    const name = (id: string | null) => (id ? (teamMap.get(id)?.name ?? "") : "");
    items.push({
      matchId: match.id,
      tournamentSlug: slug,
      kind,
      round: match.roundNo,
      teams: [name(match.reg1Id), name(match.reg2Id)],
      reportCount: mine.length,
      since: (kind === "dispute" || kind === "confirm" ? lastReport : null) ?? match.openedAt ?? now,
    });
  }
  return items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.since.getTime() - b.since.getTime());
}
