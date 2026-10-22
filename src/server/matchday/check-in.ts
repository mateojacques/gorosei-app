import { and, asc, eq } from "drizzle-orm";
import { type CheckInOutcome, type ShortHandedDecision, checkInOutcome, checkInWindow } from "../../shared/check-in";
import { writeAudit } from "../audit";
import type { Db, Executor } from "../db/client";
import { checkIns, registrationPlayers, registrations, teams, tournaments } from "../db/schema";
import { lockTournament } from "../tournaments/confirmations";

export type CheckInRejection = "not_open" | "not_on_roster" | "registration_inactive" | "not_captain" | "invalid_state";
type Result = { ok: true } | { ok: false; reason: CheckInRejection };

function isOpen(tournament: { status: string; startsAt: Date }, now: Date): boolean {
  if (tournament.status !== "check_in") return false;
  const { opensAt, closesAt } = checkInWindow(tournament.startsAt);
  return now >= opensAt && now <= closesAt;
}

async function registrationTournamentId(tx: Executor, registrationId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ tournamentId: registrations.tournamentId })
    .from(registrations)
    .where(eq(registrations.id, registrationId));
  return row?.tournamentId;
}

export async function checkIn(db: Db, userId: string, registrationId: string, now: Date): Promise<Result> {
  return db.transaction(async (tx) => {
    const tournamentId = await registrationTournamentId(tx, registrationId);
    if (!tournamentId) return { ok: false, reason: "invalid_state" } as const;
    const tournament = await lockTournament(tx, tournamentId);
    if (!tournament || !isOpen(tournament, now)) return { ok: false, reason: "not_open" } as const;
    const [registration] = await tx.select().from(registrations).where(eq(registrations.id, registrationId));
    if (registration?.status !== "confirmed") return { ok: false, reason: "registration_inactive" } as const;
    const [player] = await tx
      .select({ userId: registrationPlayers.userId })
      .from(registrationPlayers)
      .where(
        and(
          eq(registrationPlayers.registrationId, registrationId),
          eq(registrationPlayers.userId, userId),
          eq(registrationPlayers.active, true),
        ),
      );
    if (!player) return { ok: false, reason: "not_on_roster" } as const;
    const [row] = await tx
      .insert(checkIns)
      .values({ registrationId, userId, tournamentId, checkedInAt: now })
      .onConflictDoNothing()
      .returning({ userId: checkIns.userId });
    if (row) {
      await writeAudit(tx, {
        actorUserId: userId,
        action: "checkin.checked_in",
        entityType: "registration",
        entityId: registrationId,
        data: { tournamentId },
      });
    }
    return { ok: true } as const;
  });
}

export async function decideShortHanded(
  db: Db,
  captainId: string,
  registrationId: string,
  decision: ShortHandedDecision,
  now: Date,
): Promise<Result> {
  return db.transaction(async (tx) => {
    const tournamentId = await registrationTournamentId(tx, registrationId);
    if (!tournamentId) return { ok: false, reason: "invalid_state" } as const;
    const tournament = await lockTournament(tx, tournamentId);
    if (!tournament || !isOpen(tournament, now)) return { ok: false, reason: "not_open" } as const;
    const [row] = await tx
      .select({ registration: registrations, captainUserId: teams.captainUserId })
      .from(registrations)
      .innerJoin(teams, eq(teams.id, registrations.teamId))
      .where(eq(registrations.id, registrationId));
    if (!row || row.registration.status !== "confirmed") return { ok: false, reason: "registration_inactive" } as const;
    if (row.captainUserId !== captainId) return { ok: false, reason: "not_captain" } as const;
    await tx.update(registrations).set({ checkInDecision: decision, updatedAt: now }).where(eq(registrations.id, registrationId));
    await writeAudit(tx, {
      actorUserId: captainId,
      action: "checkin.decision",
      entityType: "registration",
      entityId: registrationId,
      data: { tournamentId, decision },
    });
    return { ok: true } as const;
  });
}

export type CheckInView = {
  registrationId: string;
  windowOpensAt: Date;
  windowClosesAt: Date;
  open: boolean;
  players: { userId: string; riotId: string; isSub: boolean; checkedIn: boolean }[];
  checkedInCount: number;
  decision: ShortHandedDecision | null;
  outcome: CheckInOutcome;
};

export async function getCheckInView(db: Db, registrationId: string, now: Date): Promise<CheckInView | null> {
  const [row] = await db
    .select({ registration: registrations, tournament: tournaments })
    .from(registrations)
    .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
    .where(eq(registrations.id, registrationId));
  if (!row) return null;
  const roster = await db
    .select()
    .from(registrationPlayers)
    .where(and(eq(registrationPlayers.registrationId, registrationId), eq(registrationPlayers.active, true)))
    .orderBy(asc(registrationPlayers.isSub));
  const done = new Set(
    (await db.select({ userId: checkIns.userId }).from(checkIns).where(eq(checkIns.registrationId, registrationId))).map(
      (r) => r.userId,
    ),
  );
  const players = roster.map((p) => ({
    userId: p.userId,
    riotId: p.snapshot.riotId,
    isSub: p.isSub,
    checkedIn: done.has(p.userId),
  }));
  const checkedInCount = players.filter((p) => p.checkedIn).length;
  const decision = row.registration.checkInDecision;
  const { opensAt, closesAt } = checkInWindow(row.tournament.startsAt);
  return {
    registrationId,
    windowOpensAt: opensAt,
    windowClosesAt: closesAt,
    open: isOpen(row.tournament, now),
    players,
    checkedInCount,
    decision,
    outcome: checkInOutcome(checkedInCount, decision),
  };
}
