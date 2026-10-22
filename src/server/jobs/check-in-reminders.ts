import { and, eq } from "drizzle-orm";
import { CHECK_IN_REMINDER_BEFORE_CLOSE_MINUTES, checkInWindow } from "../../shared/check-in";
import { ROSTER_STARTERS } from "../../shared/tournament";
import type { Db } from "../db/client";
import { checkIns, registrationPlayers, registrations, tournaments } from "../db/schema";
import { notify } from "../notifications/notify";
import { captainOf, tournamentRef } from "../notifications/recipients";

const MINUTE_MS = 60_000;

/**
 * Reminds the captain of each confirmed team still missing check-ins, once, in the last 15 minutes
 * before check-in closes. Only players still on the roster count.
 */
export async function sendCheckInReminders(db: Db, now: Date): Promise<{ reminded: number }> {
  let reminded = 0;
  const checkingIn = await db
    .select({ id: tournaments.id, startsAt: tournaments.startsAt })
    .from(tournaments)
    .where(eq(tournaments.status, "check_in"));
  for (const { id, startsAt } of checkingIn) {
    const { closesAt } = checkInWindow(startsAt);
    if (now < new Date(closesAt.getTime() - CHECK_IN_REMINDER_BEFORE_CLOSE_MINUTES * MINUTE_MS) || now >= closesAt) continue;
    // One failing tournament must not hold up the others.
    try {
      reminded += await remindTournament(db, id, closesAt);
    } catch (error) {
      console.error(`[jobs] check-in reminders for ${id} failed`, error);
    }
  }
  return { reminded };
}

async function remindTournament(db: Db, tournamentId: string, closesAt: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const confirmed = await tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(and(eq(registrations.tournamentId, tournamentId), eq(registrations.status, "confirmed")));
    const checkedIn = await tx
      .select({ registrationId: checkIns.registrationId })
      .from(checkIns)
      .innerJoin(
        registrationPlayers,
        and(
          eq(registrationPlayers.registrationId, checkIns.registrationId),
          eq(registrationPlayers.userId, checkIns.userId),
          eq(registrationPlayers.active, true),
        ),
      )
      .where(eq(checkIns.tournamentId, tournamentId));
    const tournament = await tournamentRef(tx, tournamentId);
    let reminded = 0;
    for (const { id } of confirmed) {
      const missing = ROSTER_STARTERS - checkedIn.filter((c) => c.registrationId === id).length;
      if (missing <= 0) continue;
      const captain = await captainOf(tx, id);
      if (!captain) continue;
      reminded += await notify(
        tx,
        [captain],
        { kind: "check_in_reminder", tournament, missing, closesAt: closesAt.toISOString() },
        `check_in_reminder:${id}`,
      );
    }
    return reminded;
  });
}
