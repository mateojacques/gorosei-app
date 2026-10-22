import { eq } from "drizzle-orm";
import { checkInWindow } from "../../shared/check-in";
import type { Db } from "../db/client";
import { tournaments } from "../db/schema";
import { closeCheckIn, openCheckIn } from "../matchday/check-in";

/** Opens check-in an hour before start and closes it ten minutes before, starting the bracket. */
export async function advanceTournaments(db: Db, now: Date): Promise<{ opened: number; closed: number }> {
  let opened = 0;
  let closed = 0;
  const waiting = await db
    .select({ id: tournaments.id, startsAt: tournaments.startsAt })
    .from(tournaments)
    .where(eq(tournaments.status, "registration_closed"));
  for (const { id, startsAt } of waiting) {
    if (now < checkInWindow(startsAt).opensAt) continue;
    // One failing tournament must not hold up the others.
    try {
      if ((await openCheckIn(db, id, now, null)).ok) opened++;
    } catch (error) {
      console.error(`[jobs] advance-tournaments: opening check-in for ${id} failed`, error);
    }
  }
  const checkingIn = await db
    .select({ id: tournaments.id, startsAt: tournaments.startsAt })
    .from(tournaments)
    .where(eq(tournaments.status, "check_in"));
  for (const { id, startsAt } of checkingIn) {
    if (now < checkInWindow(startsAt).closesAt) continue;
    try {
      if ((await closeCheckIn(db, id, now, null)).ok) closed++;
    } catch (error) {
      console.error(`[jobs] advance-tournaments: closing check-in for ${id} failed`, error);
    }
  }
  return { opened, closed };
}
