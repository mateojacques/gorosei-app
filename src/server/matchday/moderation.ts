import { and, eq } from "drizzle-orm";
import { announceMatch, announceTournament } from "./events";
import type { EligibilityFailure, RosterEntry } from "../../shared/eligibility";
import { validateScore } from "../../shared/match";
import { writeAudit } from "../audit";
import { EngineError, applyResult, bracketComplete, finalStandings, resetMatchResult } from "../bracket/engine";
import { syncMatches } from "../bracket/bracket";
import type { Db, Executor } from "../db/client";
import { brackets, checkIns, matchReports, matches, registrationPlayers, registrations, teamMembers, tournaments } from "../db/schema";
import { lockTournament } from "../tournaments/confirmations";
import {
  type RegistrationDeps,
  evaluateRegistration,
  exemptRuleIdsFor,
  snapshotWithAccount,
} from "../tournaments/registrations";
import type { Tournament } from "../tournaments/tournaments";
import { notifyMatchReady, notifyResult } from "../notifications/matchday";
import { lockMatch } from "./reports";

export type ModRejection =
  | "not_found"
  | "invalid_state"
  | "no_result"
  | "invalid_score"
  | "already_completed"
  | "next_match_started"
  | "not_member"
  | "ineligible"
  | "player_already_registered"
  | "riot_required";

type Match = typeof matches.$inferSelect;
type Reject = { ok: false; reason: ModRejection };

/** Loads the match's tournament lock, then the match row (lock order: tournament, then match). */
async function lockBoth(tx: Executor, matchId: string): Promise<{ tournament: Tournament; match: Match } | Reject> {
  const [found] = await tx.select({ tournamentId: matches.tournamentId }).from(matches).where(eq(matches.id, matchId));
  if (!found) return { ok: false, reason: "not_found" };
  const tournament = await lockTournament(tx, found.tournamentId);
  const match = await lockMatch(tx, matchId);
  if (!tournament || !match) return { ok: false, reason: "not_found" };
  return { tournament, match };
}

const failed = (r: { ok: false; reason: ModRejection } | { tournament: Tournament; match: Match }): r is Reject => "ok" in r;

/** Stores the new bracket, mirrors it into `matches` and finishes the tournament when nothing is left to play. */
async function saveBracket(
  tx: Executor,
  tournament: Tournament,
  data: Awaited<ReturnType<typeof applyResult>>,
  stageId: number,
  actorUserId: string,
  now: Date,
): Promise<boolean> {
  await tx.update(brackets).set({ data, updatedAt: now }).where(eq(brackets.tournamentId, tournament.id));
  await syncMatches(tx, tournament.id, now);
  if (!bracketComplete(data)) return false;
  const standings = await finalStandings(data, stageId);
  await tx.update(brackets).set({ finalStandings: standings }).where(eq(brackets.tournamentId, tournament.id));
  await tx.update(tournaments).set({ status: "finished", updatedAt: now }).where(eq(tournaments.id, tournament.id));
  await writeAudit(tx, {
    actorUserId,
    action: "tournament.finished",
    entityType: "tournament",
    entityId: tournament.id,
    data: { standings },
  });
  return true;
}

async function loadBracket(tx: Executor, tournamentId: string) {
  const [bracket] = await tx.select().from(brackets).where(eq(brackets.tournamentId, tournamentId)).for("update");
  return bracket;
}

const PLAYABLE = ["open", "in_progress", "reported", "disputed"];

export async function confirmMatch(
  db: Db,
  moderatorId: string,
  matchId: string,
  result?: { score1: number; score2: number },
): Promise<{ ok: true; finished: boolean } | Reject> {
  const committed = await db.transaction(async (tx) => {
    const locked = await lockBoth(tx, matchId);
    if (failed(locked)) return locked;
    const { tournament, match } = locked;
    if (match.status === "completed") return { ok: false, reason: "already_completed" } as const;
    if (tournament.status !== "live" || !PLAYABLE.includes(match.status)) return { ok: false, reason: "invalid_state" } as const;

    let score: { score1: number; score2: number };
    let source: "override" | "reports";
    if (result) {
      if (!validateScore(match.bestOf, result.score1, result.score2)) return { ok: false, reason: "invalid_score" } as const;
      score = result;
      source = "override";
    } else {
      const reports = await tx.select().from(matchReports).where(eq(matchReports.matchId, matchId));
      const first = reports[0];
      if (!first || (reports.length === 2 && (reports[1]!.score1 !== first.score1 || reports[1]!.score2 !== first.score2))) {
        return { ok: false, reason: "no_result" } as const;
      }
      score = { score1: first.score1, score2: first.score2 };
      source = "reports";
    }

    const now = new Date();
    const bracket = await loadBracket(tx, tournament.id);
    if (!bracket) return { ok: false, reason: "invalid_state" } as const;
    const data = await applyResult(bracket.data, match.bmMatchId, score);
    const finished = await saveBracket(tx, tournament, data, bracket.stageId, moderatorId, now);
    await tx.update(matches).set({ confirmedBy: moderatorId, confirmedAt: now }).where(eq(matches.id, matchId));
    await writeAudit(tx, {
      actorUserId: moderatorId,
      action: "match.confirmed",
      entityType: "match",
      entityId: matchId,
      data: { tournamentId: tournament.id, ...score, source, previousStatus: match.status },
    });
    await notifyResult(tx, matchId);
    return { ok: true, finished } as const;
  });
  if (committed.ok) void announceMatch(db, matchId);
  return committed;
}

export async function forfeitMatch(
  db: Db,
  moderatorId: string,
  matchId: string,
  forfeitingRegistrationId: string,
): Promise<{ ok: true; finished: boolean } | Reject> {
  const committed = await db.transaction(async (tx) => {
    const locked = await lockBoth(tx, matchId);
    if (failed(locked)) return locked;
    const { tournament, match } = locked;
    if (match.status === "completed") return { ok: false, reason: "already_completed" } as const;
    if (tournament.status !== "live" || !PLAYABLE.includes(match.status)) return { ok: false, reason: "invalid_state" } as const;
    const side = match.reg1Id === forfeitingRegistrationId ? 1 : match.reg2Id === forfeitingRegistrationId ? 2 : null;
    if (!side) return { ok: false, reason: "invalid_state" } as const;

    const now = new Date();
    const bracket = await loadBracket(tx, tournament.id);
    if (!bracket) return { ok: false, reason: "invalid_state" } as const;
    const data = await applyResult(bracket.data, match.bmMatchId, { forfeit: side });
    const finished = await saveBracket(tx, tournament, data, bracket.stageId, moderatorId, now);
    await tx.update(matches).set({ confirmedBy: moderatorId, confirmedAt: now }).where(eq(matches.id, matchId));
    await writeAudit(tx, {
      actorUserId: moderatorId,
      action: "match.forfeited",
      entityType: "match",
      entityId: matchId,
      data: { tournamentId: tournament.id, forfeitingRegistrationId, previousStatus: match.status },
    });
    await notifyResult(tx, matchId);
    return { ok: true, finished } as const;
  });
  if (committed.ok) void announceMatch(db, matchId);
  return committed;
}

export async function resetMatch(db: Db, moderatorId: string, matchId: string): Promise<{ ok: true } | Reject> {
  const committed = await db.transaction(async (tx) => {
    const locked = await lockBoth(tx, matchId);
    if (failed(locked)) return locked;
    const { tournament, match } = locked;
    if (match.status === "waiting" || (tournament.status !== "live" && tournament.status !== "finished")) {
      return { ok: false, reason: "invalid_state" } as const;
    }
    const now = new Date();
    const bracket = await loadBracket(tx, tournament.id);
    if (!bracket) return { ok: false, reason: "invalid_state" } as const;

    let data = bracket.data;
    if (match.status === "completed") {
      try {
        data = await resetMatchResult(bracket.data, match.bmMatchId);
      } catch (error) {
        if (error instanceof EngineError && error.code === "next_match_started") return { ok: false, reason: "next_match_started" } as const;
        throw error;
      }
    }
    const reports = await tx.select().from(matchReports).where(eq(matchReports.matchId, matchId));
    await tx.delete(matchReports).where(eq(matchReports.matchId, matchId));
    await tx.update(brackets).set({ data, finalStandings: null, updatedAt: now }).where(eq(brackets.tournamentId, tournament.id));
    if (tournament.status === "finished") {
      await tx.update(tournaments).set({ status: "live", updatedAt: now }).where(eq(tournaments.id, tournament.id));
    }
    await syncMatches(tx, tournament.id, now);
    await tx
      .update(matches)
      .set({
        status: "open",
        lobbyName: null,
        lobbyPassword: null,
        lobbyPostedBy: null,
        score1: null,
        score2: null,
        winnerRegId: null,
        confirmedBy: null,
        confirmedAt: null,
        openedAt: now,
      })
      .where(eq(matches.id, matchId));
    const [reopened] = await tx.select().from(matches).where(eq(matches.id, matchId));
    if (reopened) await notifyMatchReady(tx, reopened);
    await writeAudit(tx, {
      actorUserId: moderatorId,
      action: "match.reset",
      entityType: "match",
      entityId: matchId,
      data: {
        tournamentId: tournament.id,
        previousStatus: match.status,
        previousScore: [match.score1, match.score2],
        reports: reports.map((r) => ({ registrationId: r.registrationId, score1: r.score1, score2: r.score2, screenshotUrl: r.screenshotUrl })),
      },
    });
    return { ok: true } as const;
  });
  if (committed.ok) void announceMatch(db, matchId);
  return committed;
}

export async function swapPlayer(
  deps: RegistrationDeps,
  moderatorId: string,
  registrationId: string,
  outUserId: string,
  inUserId: string,
): Promise<{ ok: true } | { ok: false; reason: ModRejection; failures?: EligibilityFailure[] }> {
  const { db } = deps;
  const [row] = await db
    .select({ registration: registrations, tournament: tournaments })
    .from(registrations)
    .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
    .where(eq(registrations.id, registrationId));
  if (!row) return { ok: false, reason: "not_found" };
  const snapshot = await snapshotWithAccount(deps, inUserId, row.tournament.rankSource);
  if (!snapshot) return { ok: false, reason: "riot_required" };

  const committed = await db.transaction(async (tx) => {
    const tournament = await lockTournament(tx, row.tournament.id);
    const [registration] = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).for("update");
    if (
      !tournament ||
      !registration ||
      registration.status !== "confirmed" ||
      (tournament.status !== "check_in" && tournament.status !== "live")
    ) {
      return { ok: false, reason: "invalid_state" } as const;
    }
    const roster = await tx
      .select()
      .from(registrationPlayers)
      .where(and(eq(registrationPlayers.registrationId, registrationId), eq(registrationPlayers.active, true)));
    const leaving = roster.find((p) => p.userId === outUserId);
    if (!leaving) return { ok: false, reason: "not_member" } as const;
    const [member] = await tx
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, registration.teamId), eq(teamMembers.userId, inUserId)));
    if (!member) return { ok: false, reason: "not_member" } as const;

    const alreadyHere = roster.find((p) => p.userId === inUserId);
    const [elsewhere] = await tx
      .select({ registrationId: registrationPlayers.registrationId })
      .from(registrationPlayers)
      .where(
        and(
          eq(registrationPlayers.tournamentId, tournament.id),
          eq(registrationPlayers.userId, inUserId),
          eq(registrationPlayers.active, true),
        ),
      );
    if (elsewhere && elsewhere.registrationId !== registrationId) {
      return { ok: false, reason: "player_already_registered" } as const;
    }

    const entries: RosterEntry[] = roster
      .filter((p) => p.userId !== outUserId && p.userId !== inUserId)
      .map((p) => ({ ...p.snapshot, isSub: p.isSub }));
    entries.push({ ...(alreadyHere ? alreadyHere.snapshot : snapshot.snapshot), isSub: leaving.isSub });
    const failures = evaluateRegistration(tournament, entries, await exemptRuleIdsFor(tx, tournament.id, registration.teamId));
    if (failures.length > 0) return { ok: false, reason: "ineligible", failures } as const;

    await tx
      .update(registrationPlayers)
      .set({ active: false })
      .where(and(eq(registrationPlayers.registrationId, registrationId), eq(registrationPlayers.userId, outUserId)));
    if (alreadyHere) {
      await tx
        .update(registrationPlayers)
        .set({ isSub: leaving.isSub })
        .where(and(eq(registrationPlayers.registrationId, registrationId), eq(registrationPlayers.userId, inUserId)));
    } else {
      await tx
        .insert(registrationPlayers)
        .values({
          registrationId,
          userId: inUserId,
          tournamentId: tournament.id,
          riotAccountId: snapshot.riotAccountId,
          isSub: leaving.isSub,
          snapshot: snapshot.snapshot,
        })
        .onConflictDoUpdate({
          target: [registrationPlayers.registrationId, registrationPlayers.userId],
          set: { active: true, isSub: leaving.isSub, snapshot: snapshot.snapshot, riotAccountId: snapshot.riotAccountId },
        });
    }
    await tx
      .insert(checkIns)
      .values({ registrationId, userId: inUserId, tournamentId: tournament.id, byUserId: moderatorId })
      .onConflictDoNothing();
    await writeAudit(tx, {
      actorUserId: moderatorId,
      action: "registration.player_swapped",
      entityType: "registration",
      entityId: registrationId,
      data: { tournamentId: tournament.id, out: outUserId, in: inUserId },
    });
    return { ok: true } as const;
  });
  if (committed.ok) announceTournament(row.tournament.id);
  return committed;
}

const MAX_VOD_URL = 300;

function validVodUrl(url: string): boolean {
  if (url.length > MAX_VOD_URL) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

/** Sets (or, with null, clears) the match's VOD link; https only. */
export async function setMatchVod(
  db: Db,
  moderatorId: string,
  matchId: string,
  url: string | null,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "invalid_url" }> {
  const value = url === null ? null : url.trim();
  if (value !== null && !validVodUrl(value)) return { ok: false, reason: "invalid_url" };
  const committed = await db.transaction(async (tx) => {
    const [updated] = await tx.update(matches).set({ vodUrl: value }).where(eq(matches.id, matchId)).returning({ tournamentId: matches.tournamentId });
    if (!updated) return { ok: false, reason: "not_found" } as const;
    await writeAudit(tx, {
      actorUserId: moderatorId,
      action: "match.vod_set",
      entityType: "match",
      entityId: matchId,
      data: { tournamentId: updated.tournamentId, url: value },
    });
    return { ok: true } as const;
  });
  if (committed.ok) void announceMatch(db, matchId);
  return committed;
}
