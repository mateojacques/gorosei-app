import { and, asc, eq, inArray } from "drizzle-orm";
import { type CheckInOutcome, type ShortHandedDecision, checkInOutcome, checkInWindow } from "../../shared/check-in";
import { writeAudit } from "../audit";
import type { Db, Executor } from "../db/client";
import { checkIns, entryPayments, registrationPlayers, registrations, teams, tournaments } from "../db/schema";
import { startBracket } from "../bracket/bracket";
import { lockTournament } from "../tournaments/confirmations";
import { cancelLockedTournament } from "../tournaments/credits";

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

export async function openCheckIn(
  db: Db,
  tournamentId: string,
  now: Date,
  actorUserId: string | null,
  opts: { force?: boolean } = {},
): Promise<{ ok: true } | { ok: false; reason: "invalid_state" | "too_early" }> {
  return db.transaction(async (tx) => {
    const tournament = await lockTournament(tx, tournamentId);
    if (tournament?.status !== "registration_closed") return { ok: false, reason: "invalid_state" } as const;
    if (!opts.force && now < checkInWindow(tournament.startsAt).opensAt) return { ok: false, reason: "too_early" } as const;
    await tx.update(tournaments).set({ status: "check_in", updatedAt: now }).where(eq(tournaments.id, tournamentId));
    await writeAudit(tx, {
      actorUserId,
      action: "tournament.check_in_opened",
      entityType: "tournament",
      entityId: tournamentId,
      data: { forced: opts.force === true },
    });
    return { ok: true } as const;
  });
}

export async function closeCheckIn(
  db: Db,
  tournamentId: string,
  now: Date,
  actorUserId: string | null,
  opts: { force?: boolean } = {},
): Promise<
  | { ok: true; outcome: "live" | "cancelled"; forfeited: number; teams: number }
  | { ok: false; reason: "invalid_state" | "too_early" }
> {
  return db.transaction(async (tx) => {
    const tournament = await lockTournament(tx, tournamentId);
    if (tournament?.status !== "check_in") return { ok: false, reason: "invalid_state" } as const;
    if (!opts.force && now < checkInWindow(tournament.startsAt).closesAt) return { ok: false, reason: "too_early" } as const;

    const regs = await tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.tournamentId, tournamentId), eq(registrations.status, "confirmed")))
      .for("update");
    const done = await tx.select().from(checkIns).where(eq(checkIns.tournamentId, tournamentId));
    const survivors: string[] = [];
    let forfeited = 0;
    for (const registration of regs) {
      const count = done.filter((c) => c.registrationId === registration.id).length;
      const outcome = checkInOutcome(count, registration.checkInDecision);
      if (outcome === "in" || outcome === "short_handed") {
        survivors.push(registration.id);
        continue;
      }
      forfeited++;
      const roster = await tx
        .select({ userId: registrationPlayers.userId })
        .from(registrationPlayers)
        .where(eq(registrationPlayers.registrationId, registration.id));
      await tx.update(registrations).set({ status: "forfeited", qualifiedAt: null, updatedAt: now }).where(eq(registrations.id, registration.id));
      await tx.update(registrationPlayers).set({ active: false }).where(eq(registrationPlayers.registrationId, registration.id));
      if (roster.length > 0) {
        await tx
          .update(entryPayments)
          .set({ forfeited: true })
          .where(
            and(
              eq(entryPayments.tournamentId, tournamentId),
              eq(entryPayments.forfeited, false),
              inArray(
                entryPayments.userId,
                roster.map((r) => r.userId),
              ),
            ),
          );
      }
      await writeAudit(tx, {
        actorUserId,
        action: "registration.forfeited",
        entityType: "registration",
        entityId: registration.id,
        data: { tournamentId, reason: outcome, checkedIn: count },
      });
    }

    if (survivors.length < 2) {
      await cancelLockedTournament(tx, tournament, actorUserId, "no_field");
      return { ok: true, outcome: "cancelled", forfeited, teams: regs.length } as const;
    }
    await startBracket(tx, tournament, survivors, now);
    await tx.update(tournaments).set({ status: "live", updatedAt: now }).where(eq(tournaments.id, tournamentId));
    await writeAudit(tx, {
      actorUserId,
      action: "tournament.live",
      entityType: "tournament",
      entityId: tournamentId,
      data: { teams: survivors.length, forfeited },
    });
    return { ok: true, outcome: "live", forfeited, teams: regs.length } as const;
  });
}
