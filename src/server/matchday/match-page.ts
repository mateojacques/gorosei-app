import { eq } from "drizzle-orm";
import type { UserRole } from "../../shared/match";
import { canSeeMatchPrivate, getMatchView } from "../bracket/bracket";
import type { Db } from "../db/client";
import { teams, tournaments } from "../db/schema";
import { listMessages } from "./chat";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Viewer = { userId: string; role: UserRole };

/**
 * The match page. Anyone may read a match of a public tournament once it has a team; the lobby, reports and chat
 * stay with the two teams and moderators.
 */
export async function loadMatchPage(db: Db, matchId: string, viewer: Viewer | null, now: Date) {
  if (!UUID.test(matchId)) return null;
  const match = await getMatchView(db, matchId, viewer, now);
  if (!match || (match.teams[0] === null && match.teams[1] === null)) return null;
  const [tournament] = await db
    .select({ slug: tournaments.slug, title: tournaments.title, edition: tournaments.edition, status: tournaments.status })
    .from(tournaments)
    .where(eq(tournaments.id, match.tournamentId));
  if (!tournament || tournament.status === "draft") return null;
  const canSeePrivate = await canSeeMatchPrivate(
    db,
    { reg1Id: match.teams[0]?.registrationId ?? null, reg2Id: match.teams[1]?.registrationId ?? null },
    viewer,
  );
  const messages = viewer && canSeePrivate ? ((await listMessages(db, { id: viewer.userId, role: viewer.role }, matchId)) ?? []) : [];
  // Which side (if any) the viewer captains: only captains report.
  const captained = await Promise.all(
    match.teams.map(async (team) => {
      if (!team || !viewer || !canSeePrivate) return false;
      const [row] = await db.select({ captainUserId: teams.captainUserId }).from(teams).where(eq(teams.id, team.teamId));
      return row?.captainUserId === viewer.userId;
    }),
  );
  const { status: _status, ...tournamentInfo } = tournament;
  return {
    match,
    tournament: tournamentInfo,
    messages,
    captainSide: captained[0] ? (0 as const) : captained[1] ? (1 as const) : null,
    viewer,
    canSeePrivate,
  };
}

export type MatchPage = NonNullable<Awaited<ReturnType<typeof loadMatchPage>>>;
