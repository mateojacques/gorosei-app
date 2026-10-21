import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { RosterEntry } from "../../shared/eligibility";
import { ROSTER_STARTERS } from "../../shared/tournament";
import type { RegistrationStatus } from "../../shared/tournament";
import { writeAudit } from "../audit";
import type { Db, Executor } from "../db/client";
import { eligibilityExceptions, entryCredits, entryPayments, registrationPlayers, registrations, tournaments } from "../db/schema";
import { evaluateRegistration } from "./registrations";
import type { Tournament } from "./tournaments";

/*
 * Lock order, shared by every path that changes confirmations: team row, then tournament row,
 * then registration rows. recomputeConfirmations runs last in the transaction.
 */

const LIVE_STATUSES: RegistrationStatus[] = ["pending", "confirmed", "waitlisted"];
const INACTIVE_STATUSES: RegistrationStatus[] = ["withdrawn", "dropped"];

const STATUS_AUDIT: Partial<Record<RegistrationStatus, string>> = {
  confirmed: "registration.confirmed",
  waitlisted: "registration.waitlisted",
  pending: "registration.unconfirmed",
};

export async function lockTournament(tx: Executor, tournamentId: string): Promise<Tournament | undefined> {
  const [row] = await tx.select().from(tournaments).where(eq(tournaments.id, tournamentId)).for("update");
  return row;
}

/** Payments and credits only move while registration is open or closed; close and cancel own the rest. */
export function takesPayments(tournament: Tournament | undefined): tournament is Tournament {
  return tournament?.status === "registration_open" || tournament?.status === "registration_closed";
}

/** Users with a live (non-forfeited) payment for the tournament. */
export async function paidUserIds(tx: Executor, tournamentId: string): Promise<Set<string>> {
  const rows = await tx
    .select({ userId: entryPayments.userId })
    .from(entryPayments)
    .where(and(eq(entryPayments.tournamentId, tournamentId), eq(entryPayments.forfeited, false)));
  return new Set(rows.map((r) => r.userId));
}

/** Full roster, eligible with the team's exceptions, and 5 roster players paid (or a free tournament). */
export function rosterQualifies(
  tournament: Tournament,
  roster: RosterEntry[],
  exemptRuleIds: string[],
  paid: Set<string>,
): boolean {
  if (roster.filter((p) => !p.isSub).length !== ROSTER_STARTERS) return false;
  if (evaluateRegistration(tournament, roster, exemptRuleIds).length > 0) return false;
  return tournament.entryFeeArs === 0 || roster.filter((p) => paid.has(p.userId)).length >= ROSTER_STARTERS;
}

export async function recomputeConfirmations(tx: Executor, tournamentId: string, now: Date): Promise<void> {
  const tournament = await lockTournament(tx, tournamentId);
  // After close, statuses only change through withdraw or force-remove.
  if (!tournament || tournament.status !== "registration_open") return;

  const regs = await tx
    .select()
    .from(registrations)
    .where(and(eq(registrations.tournamentId, tournamentId), inArray(registrations.status, LIVE_STATUSES)));
  if (regs.length === 0) return;
  const players = await tx
    .select()
    .from(registrationPlayers)
    .where(
      inArray(
        registrationPlayers.registrationId,
        regs.map((r) => r.id),
      ),
    );
  const exceptions = await tx
    .select({ teamId: eligibilityExceptions.teamId, ruleId: eligibilityExceptions.ruleId })
    .from(eligibilityExceptions)
    .where(eq(eligibilityExceptions.tournamentId, tournamentId));
  const paid = await paidUserIds(tx, tournamentId);

  const evaluated = regs.map((registration) => {
    const roster = players
      .filter((p) => p.registrationId === registration.id)
      .map((p) => ({ ...p.snapshot, isSub: p.isSub }));
    const exempt = exceptions.filter((e) => e.teamId === registration.teamId).map((e) => e.ruleId);
    const qualifies = rosterQualifies(tournament, roster, exempt, paid);
    const qualifiedAt = qualifies ? (registration.qualifiedAt ?? now) : null;
    return { registration, qualifies, qualifiedAt };
  });

  const byQualifiedAt = (a: (typeof evaluated)[number], b: (typeof evaluated)[number]) =>
    a.qualifiedAt!.getTime() - b.qualifiedAt!.getTime() ||
    a.registration.createdAt.getTime() - b.registration.createdAt.getTime() ||
    a.registration.id.localeCompare(b.registration.id);
  const qualifying = evaluated.filter((e) => e.qualifies);
  // Confirmed teams keep their slots (the earliest qualified, if the cap shrank); the rest go in qualifying order.
  const kept = qualifying
    .filter((e) => e.registration.status === "confirmed")
    .sort(byQualifiedAt)
    .slice(0, tournament.teamCap);
  const others = qualifying.filter((e) => !kept.includes(e)).sort(byQualifiedAt);
  const confirmed = new Set([...kept, ...others.slice(0, Math.max(0, tournament.teamCap - kept.length))]);

  for (const entry of evaluated) {
    const { registration, qualifiedAt } = entry;
    const status: RegistrationStatus = confirmed.has(entry) ? "confirmed" : entry.qualifies ? "waitlisted" : "pending";
    const statusChanged = status !== registration.status;
    if (!statusChanged && qualifiedAt?.getTime() === registration.qualifiedAt?.getTime()) continue;
    await tx
      .update(registrations)
      .set({ status, qualifiedAt, ...(statusChanged ? { updatedAt: now } : {}) })
      .where(eq(registrations.id, registration.id));
    if (statusChanged) {
      await writeAudit(tx, {
        actorUserId: null,
        action: STATUS_AUDIT[status]!,
        entityType: "registration",
        entityId: registration.id,
        data: { tournamentId, from: registration.status, to: status },
      });
    }
  }
}

export async function markPaid(
  db: Db,
  adminId: string,
  tournamentId: string,
  userIds: string[],
  reference: string,
): Promise<{ ok: true; marked: number } | { ok: false; reason: "invalid_state" }> {
  return db.transaction(async (tx) => {
    // Taking the tournament lock first serializes concurrent marks racing for the last slot.
    if (!takesPayments(await lockTournament(tx, tournamentId))) return { ok: false, reason: "invalid_state" } as const;
    let marked = 0;
    for (const userId of new Set(userIds)) {
      // Already-paid players are skipped; a forfeited payment is replaced by the new one.
      const [previous] = await tx
        .select({ reference: entryPayments.reference })
        .from(entryPayments)
        .where(
          and(eq(entryPayments.tournamentId, tournamentId), eq(entryPayments.userId, userId), eq(entryPayments.forfeited, true)),
        );
      const [row] = await tx
        .insert(entryPayments)
        .values({ tournamentId, userId, source: "payment", reference, recordedBy: adminId })
        .onConflictDoUpdate({
          target: [entryPayments.tournamentId, entryPayments.userId],
          set: { source: "payment", reference, creditId: null, forfeited: false, recordedBy: adminId, recordedAt: new Date() },
          setWhere: eq(entryPayments.forfeited, true),
        })
        .returning({ id: entryPayments.id });
      if (!row) continue;
      marked++;
      await writeAudit(tx, {
        actorUserId: adminId,
        action: "payment.marked",
        entityType: "entry_payment",
        entityId: row.id,
        data: {
          tournamentId,
          userId,
          reference,
          ...(previous ? { replacedForfeited: true, previousReference: previous.reference } : {}),
        },
      });
    }
    await recomputeConfirmations(tx, tournamentId, new Date());
    return { ok: true, marked } as const;
  });
}

export async function unmarkPaid(
  db: Db,
  adminId: string,
  tournamentId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_paid" | "invalid_state" }> {
  return db.transaction(async (tx) => {
    if (!takesPayments(await lockTournament(tx, tournamentId))) return { ok: false, reason: "invalid_state" } as const;
    const [payment] = await tx
      .delete(entryPayments)
      .where(
        and(eq(entryPayments.tournamentId, tournamentId), eq(entryPayments.userId, userId), eq(entryPayments.forfeited, false)),
      )
      .returning();
    if (!payment) return { ok: false, reason: "not_paid" } as const;
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "payment.unmarked",
      entityType: "entry_payment",
      entityId: payment.id,
      data: { tournamentId, userId, source: payment.source, reference: payment.reference, creditId: payment.creditId },
    });
    // A payment made with a credit gives the credit back.
    if (payment.creditId) {
      const [credit] = await tx
        .update(entryCredits)
        .set({ status: "available", usedPaymentId: null })
        .where(and(eq(entryCredits.id, payment.creditId), eq(entryCredits.status, "used")))
        .returning({ id: entryCredits.id });
      if (credit) {
        await writeAudit(tx, {
          actorUserId: adminId,
          action: "credit.restored",
          entityType: "entry_credit",
          entityId: credit.id,
          data: { tournamentId, userId, paymentId: payment.id },
        });
      }
    }
    await recomputeConfirmations(tx, tournamentId, new Date());
    return { ok: true } as const;
  });
}

export async function grantEligibilityException(
  db: Db,
  adminId: string,
  input: { tournamentId: string; teamId: string; ruleId: string; reason: string },
): Promise<{ ok: true }> {
  const { tournamentId, teamId, ruleId, reason } = input;
  return db.transaction(async (tx) => {
    await lockTournament(tx, tournamentId);
    await tx
      .insert(eligibilityExceptions)
      .values({ tournamentId, teamId, ruleId, reason, grantedBy: adminId })
      .onConflictDoUpdate({
        target: [eligibilityExceptions.tournamentId, eligibilityExceptions.teamId, eligibilityExceptions.ruleId],
        set: { reason, grantedBy: adminId, grantedAt: new Date() },
      });
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "eligibility.exception_granted",
      entityType: "tournament",
      entityId: tournamentId,
      data: { teamId, ruleId, reason },
    });
    await recomputeConfirmations(tx, tournamentId, new Date());
    return { ok: true } as const;
  });
}

export async function revokeEligibilityException(
  db: Db,
  adminId: string,
  input: { tournamentId: string; teamId: string; ruleId: string },
): Promise<{ ok: true }> {
  const { tournamentId, teamId, ruleId } = input;
  return db.transaction(async (tx) => {
    await lockTournament(tx, tournamentId);
    await tx
      .delete(eligibilityExceptions)
      .where(
        and(
          eq(eligibilityExceptions.tournamentId, tournamentId),
          eq(eligibilityExceptions.teamId, teamId),
          eq(eligibilityExceptions.ruleId, ruleId),
        ),
      );
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "eligibility.exception_revoked",
      entityType: "tournament",
      entityId: tournamentId,
      data: { teamId, ruleId },
    });
    await recomputeConfirmations(tx, tournamentId, new Date());
    return { ok: true } as const;
  });
}

export async function forceRemoveRegistration(
  db: Db,
  adminId: string,
  registrationId: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ tournamentId: registrations.tournamentId })
      .from(registrations)
      .where(eq(registrations.id, registrationId));
    if (!found) return { ok: false, reason: "not_found" } as const;
    await lockTournament(tx, found.tournamentId);
    const [registration] = await tx
      .update(registrations)
      .set({ status: "dropped", qualifiedAt: null, updatedAt: new Date() })
      .where(and(eq(registrations.id, registrationId), notInArray(registrations.status, INACTIVE_STATUSES)))
      .returning();
    // Already withdrawn or dropped: nothing left to remove.
    if (!registration) return { ok: true } as const;
    await tx.update(registrationPlayers).set({ active: false }).where(eq(registrationPlayers.registrationId, registrationId));
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "registration.force_removed",
      entityType: "registration",
      entityId: registrationId,
      data: { tournamentId: found.tournamentId, reason },
    });
    await recomputeConfirmations(tx, found.tournamentId, new Date());
    return { ok: true } as const;
  });
}
