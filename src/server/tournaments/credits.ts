import { and, desc, eq, inArray } from "drizzle-orm";
import type { RegistrationStatus } from "../../shared/tournament";
import { writeAudit } from "../audit";
import type { Db, Executor } from "../db/client";
import { entryCredits, entryPayments, registrationPlayers, registrations, tournaments } from "../db/schema";
import { acceptsPaymentFor, lockTournament, recomputeConfirmations, takesPayments } from "./confirmations";

export type EntryCredit = typeof entryCredits.$inferSelect;
type CreditReason = EntryCredit["reason"];

const DROPPED_AT_CLOSE: RegistrationStatus[] = ["pending", "waitlisted"];

/**
 * Grants a credit for a payment in `sourceTournamentId`. A player already credited for that tournament keeps
 * their earlier credit, so close and cancel can both run without doubling it. Returns whether one was granted.
 */
async function grantCredit(
  tx: Executor,
  input: { userId: string; sourceTournamentId: string; reason: CreditReason; note: string; createdBy: string | null },
): Promise<boolean> {
  const [credit] = await tx.insert(entryCredits).values(input).onConflictDoNothing().returning();
  if (!credit) return false;
  await writeAudit(tx, {
    actorUserId: input.createdBy,
    action: "credit.granted",
    entityType: "entry_credit",
    entityId: credit.id,
    data: { userId: input.userId, sourceTournamentId: input.sourceTournamentId, reason: input.reason },
  });
  return true;
}

/** Live (non-forfeited) payments for the tournament. */
function livePayments(tx: Executor, tournamentId: string) {
  return tx
    .select({ userId: entryPayments.userId })
    .from(entryPayments)
    .where(and(eq(entryPayments.tournamentId, tournamentId), eq(entryPayments.forfeited, false)));
}

export async function closeRegistration(
  db: Db,
  tournamentId: string,
  now: Date,
  actorUserId: string | null,
): Promise<{ ok: true; dropped: number; credited: number } | { ok: false; reason: "invalid_state" }> {
  return db.transaction(async (tx) => {
    const tournament = await lockTournament(tx, tournamentId);
    if (tournament?.status !== "registration_open") return { ok: false, reason: "invalid_state" } as const;

    // Each player's registration status before the drop decides their credit reason.
    const rosters = await tx
      .select({ userId: registrationPlayers.userId, status: registrations.status })
      .from(registrationPlayers)
      .innerJoin(registrations, eq(registrations.id, registrationPlayers.registrationId))
      .where(and(eq(registrationPlayers.tournamentId, tournamentId), eq(registrationPlayers.active, true)));
    const statusOf = new Map(rosters.map((r) => [r.userId, r.status]));

    // The tournament lock keeps these rows stable: every path that changes registrations takes it first.
    const dropped = await tx
      .select({ id: registrations.id, status: registrations.status })
      .from(registrations)
      .where(and(eq(registrations.tournamentId, tournamentId), inArray(registrations.status, DROPPED_AT_CLOSE)));
    for (const registration of dropped) {
      await tx
        .update(registrations)
        .set({ status: "dropped", qualifiedAt: null, updatedAt: now })
        .where(eq(registrations.id, registration.id));
      await tx.update(registrationPlayers).set({ active: false }).where(eq(registrationPlayers.registrationId, registration.id));
      await writeAudit(tx, {
        actorUserId,
        action: "registration.dropped",
        entityType: "registration",
        entityId: registration.id,
        data: { tournamentId, from: registration.status, to: "dropped" },
      });
    }

    let credited = 0;
    for (const { userId } of await livePayments(tx, tournamentId)) {
      const status = statusOf.get(userId);
      // Players on a confirmed roster are playing; everyone else who paid gets their entry back as a credit.
      if (status === "confirmed") continue;
      const reason = status === "waitlisted" ? "waitlisted" : "unconfirmed";
      if (await grantCredit(tx, { userId, sourceTournamentId: tournamentId, reason, note: "", createdBy: actorUserId })) {
        credited++;
      }
    }

    await tx.update(tournaments).set({ status: "registration_closed", updatedAt: now }).where(eq(tournaments.id, tournamentId));
    await writeAudit(tx, {
      actorUserId,
      action: "tournament.registration_closed",
      entityType: "tournament",
      entityId: tournamentId,
      data: { dropped: dropped.length, credited },
    });
    return { ok: true, dropped: dropped.length, credited } as const;
  });
}

export async function cancelTournament(
  db: Db,
  adminId: string,
  tournamentId: string,
  reason: string,
): Promise<{ ok: true; credited: number } | { ok: false; reason: "invalid_state" }> {
  return db.transaction(async (tx) => {
    const tournament = await lockTournament(tx, tournamentId);
    if (!tournament || tournament.status === "finished" || tournament.status === "cancelled") {
      return { ok: false, reason: "invalid_state" } as const;
    }
    let credited = 0;
    // Players credited at close keep that credit; everyone else who paid gets one now.
    for (const { userId } of await livePayments(tx, tournamentId)) {
      const input = { userId, sourceTournamentId: tournamentId, reason: "cancelled" as const, note: reason, createdBy: adminId };
      if (await grantCredit(tx, input)) credited++;
    }
    await tx.update(tournaments).set({ status: "cancelled", updatedAt: new Date() }).where(eq(tournaments.id, tournamentId));
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "tournament.cancelled",
      entityType: "tournament",
      entityId: tournamentId,
      data: { from: tournament.status, reason, credited },
    });
    return { ok: true, credited } as const;
  });
}

export async function applyCredit(
  db: Db,
  adminId: string,
  creditId: string,
  tournamentId: string,
): Promise<{ ok: true } | { ok: false; reason: "credit_unavailable" | "already_paid" | "invalid_state" }> {
  return db.transaction(async (tx) => {
    const tournament = await lockTournament(tx, tournamentId);
    if (!takesPayments(tournament)) return { ok: false, reason: "invalid_state" } as const;
    const [credit] = await tx.select().from(entryCredits).where(eq(entryCredits.id, creditId)).for("update");
    if (credit?.status !== "available") return { ok: false, reason: "credit_unavailable" } as const;
    // After close, spending a credit on a player who can't play would burn it.
    if (!(await acceptsPaymentFor(tx, tournament, [credit.userId]))) return { ok: false, reason: "invalid_state" } as const;

    // Like markPaid, a forfeited payment is replaced; a live one means the player already paid.
    const [previous] = await tx
      .select({ reference: entryPayments.reference })
      .from(entryPayments)
      .where(
        and(eq(entryPayments.tournamentId, tournamentId), eq(entryPayments.userId, credit.userId), eq(entryPayments.forfeited, true)),
      );
    const reference = `credit:${creditId}`;
    const [payment] = await tx
      .insert(entryPayments)
      .values({ tournamentId, userId: credit.userId, source: "credit", reference, creditId, recordedBy: adminId })
      .onConflictDoUpdate({
        target: [entryPayments.tournamentId, entryPayments.userId],
        set: { source: "credit", reference, creditId, forfeited: false, recordedBy: adminId, recordedAt: new Date() },
        setWhere: eq(entryPayments.forfeited, true),
      })
      .returning({ id: entryPayments.id });
    if (!payment) return { ok: false, reason: "already_paid" } as const;

    await tx.update(entryCredits).set({ status: "used", usedPaymentId: payment.id }).where(eq(entryCredits.id, creditId));
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "credit.used",
      entityType: "entry_credit",
      entityId: creditId,
      data: { userId: credit.userId, tournamentId, paymentId: payment.id },
    });
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "payment.marked",
      entityType: "entry_payment",
      entityId: payment.id,
      data: {
        tournamentId,
        userId: credit.userId,
        reference,
        creditId,
        ...(previous ? { replacedForfeited: true, previousReference: previous.reference } : {}),
      },
    });
    await recomputeConfirmations(tx, tournamentId, new Date());
    return { ok: true } as const;
  });
}

export async function grantManualCredit(
  db: Db,
  adminId: string,
  userId: string,
  note: string,
): Promise<{ ok: true; creditId: string }> {
  return db.transaction(async (tx) => {
    const [credit] = await tx
      .insert(entryCredits)
      .values({ userId, sourceTournamentId: null, reason: "manual", note, createdBy: adminId })
      .returning({ id: entryCredits.id });
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "credit.granted",
      entityType: "entry_credit",
      entityId: credit!.id,
      data: { userId, sourceTournamentId: null, reason: "manual", note },
    });
    return { ok: true, creditId: credit!.id } as const;
  });
}

export async function revokeCredit(
  db: Db,
  adminId: string,
  creditId: string,
): Promise<{ ok: true } | { ok: false; reason: "credit_unavailable" }> {
  return db.transaction(async (tx) => {
    const [credit] = await tx
      .update(entryCredits)
      .set({ status: "revoked" })
      .where(and(eq(entryCredits.id, creditId), eq(entryCredits.status, "available")))
      .returning();
    if (!credit) return { ok: false, reason: "credit_unavailable" } as const;
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "credit.revoked",
      entityType: "entry_credit",
      entityId: creditId,
      data: { userId: credit.userId },
    });
    return { ok: true } as const;
  });
}

export async function listCreditsForUser(db: Db, userId: string): Promise<EntryCredit[]> {
  return db.select().from(entryCredits).where(eq(entryCredits.userId, userId)).orderBy(desc(entryCredits.createdAt));
}
