import { and, eq } from "drizzle-orm";
import { announceMatch } from "./events";
import { type ReportInput, type MatchStatus, validateScore } from "../../shared/match";
import { writeAudit } from "../audit";
import type { Db, Executor } from "../db/client";
import { matchMessages, matchReports, matches, registrationPlayers, teams, registrations } from "../db/schema";
import { notifyDisputed } from "../notifications/matchday";

export type ReportRejection =
  | "not_found"
  | "not_participant"
  | "not_captain"
  | "not_open"
  | "already_confirmed"
  | "invalid_score"
  | "lobby_exists";

export async function lockMatch(tx: Executor, matchId: string) {
  const [row] = await tx.select().from(matches).where(eq(matches.id, matchId)).for("update");
  return row;
}

export async function postLobby(
  db: Db,
  moderatorId: string,
  matchId: string,
  lobby: { name: string; password: string },
): Promise<{ ok: true } | { ok: false; reason: ReportRejection }> {
  const result = await db.transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    if (!match) return { ok: false, reason: "not_found" } as const;
    if (match.lobbyName !== null) return { ok: false, reason: "lobby_exists" } as const;
    if (match.status !== "open") return { ok: false, reason: "not_open" } as const;
    await tx
      .update(matches)
      .set({ status: "in_progress", lobbyName: lobby.name, lobbyPassword: lobby.password, lobbyPostedBy: moderatorId })
      .where(eq(matches.id, matchId));
    await tx.insert(matchMessages).values({ matchId, authorUserId: moderatorId, kind: "lobby", body: lobby.name });
    await writeAudit(tx, {
      actorUserId: moderatorId,
      action: "match.lobby_posted",
      entityType: "match",
      entityId: matchId,
      data: { tournamentId: match.tournamentId, lobbyName: lobby.name },
    });
    return { ok: true } as const;
  });
  if (result.ok) void announceMatch(db, matchId);
  return result;
}

const REPORTABLE: MatchStatus[] = ["open", "in_progress", "reported", "disputed"];

export async function reportResult(
  db: Db,
  captainId: string,
  matchId: string,
  input: ReportInput,
): Promise<{ ok: true; status: "in_progress" | "reported" | "disputed" } | { ok: false; reason: ReportRejection }> {
  const result = await db.transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    if (!match) return { ok: false, reason: "not_found" } as const;

    const sides = [match.reg1Id, match.reg2Id] as const;
    const captains = await Promise.all(
      sides.map(async (registrationId) => {
        if (!registrationId) return null;
        const [row] = await tx
          .select({ captainUserId: teams.captainUserId })
          .from(registrations)
          .innerJoin(teams, eq(teams.id, registrations.teamId))
          .where(eq(registrations.id, registrationId));
        return row?.captainUserId ?? null;
      }),
    );
    const side = captains.findIndex((c) => c === captainId);
    if (side === -1) {
      const [player] = await tx
        .select({ registrationId: registrationPlayers.registrationId })
        .from(registrationPlayers)
        .where(and(eq(registrationPlayers.userId, captainId), eq(registrationPlayers.active, true)));
      const onTeam = player && (player.registrationId === match.reg1Id || player.registrationId === match.reg2Id);
      return { ok: false, reason: onTeam ? "not_captain" : "not_participant" } as const;
    }
    if (match.status === "completed") return { ok: false, reason: "already_confirmed" } as const;
    if (!REPORTABLE.includes(match.status)) return { ok: false, reason: "not_open" } as const;
    if (!validateScore(match.bestOf, input.own, input.opponent)) return { ok: false, reason: "invalid_score" } as const;

    const registrationId = sides[side]!;
    const score1 = side === 0 ? input.own : input.opponent;
    const score2 = side === 0 ? input.opponent : input.own;
    const now = new Date();
    await tx
      .insert(matchReports)
      .values({
        matchId,
        registrationId,
        score1,
        score2,
        screenshotUrl: input.screenshotUrl,
        riotMatchIds: input.riotMatchIds,
      })
      .onConflictDoUpdate({
        target: [matchReports.matchId, matchReports.registrationId],
        set: { score1, score2, screenshotUrl: input.screenshotUrl, riotMatchIds: input.riotMatchIds, updatedAt: now },
      });

    const reports = await tx.select().from(matchReports).where(eq(matchReports.matchId, matchId));
    let status: "in_progress" | "reported" | "disputed" = "in_progress";
    if (reports.length === 2) {
      const [r1, r2] = reports as [(typeof reports)[number], (typeof reports)[number]];
      status = r1.score1 === r2.score1 && r1.score2 === r2.score2 ? "reported" : "disputed";
    }
    await tx.update(matches).set({ status }).where(eq(matches.id, matchId));
    if (status === "disputed" && match.status !== "disputed") await notifyDisputed(tx, match);
    await writeAudit(tx, {
      actorUserId: captainId,
      action: "match.reported",
      entityType: "match",
      entityId: matchId,
      data: { tournamentId: match.tournamentId, registrationId, score1, score2, status, screenshotUrl: input.screenshotUrl },
    });
    return { ok: true, status } as const;
  });
  if (result.ok) void announceMatch(db, matchId);
  return result;
}
