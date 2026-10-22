import { and, eq, inArray } from "drizzle-orm";
import { type MatchStatus, bestOfFor } from "../../shared/match";
import { seedOrder } from "../../shared/seeding";
import type { Executor } from "../db/client";
import { brackets, matches, registrationPlayers, registrations } from "../db/schema";
import type { Tournament } from "../tournaments/tournaments";
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
    if (m.status === "archived") continue;
    const previous = existing.get(m.id);
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
