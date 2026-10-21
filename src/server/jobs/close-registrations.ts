import { and, eq, lte } from "drizzle-orm";
import type { Db } from "../db/client";
import { tournaments } from "../db/schema";
import { closeRegistration } from "../tournaments/credits";

/** Closes every open tournament whose registration close time has passed. */
export async function closeDueRegistrations(db: Db, now: Date): Promise<{ closed: number }> {
  const due = await db
    .select({ id: tournaments.id })
    .from(tournaments)
    .where(and(eq(tournaments.status, "registration_open"), lte(tournaments.registrationClosesAt, now)));

  let closed = 0;
  for (const { id } of due) {
    // A tournament closed or cancelled since the select comes back invalid_state and isn't counted.
    // One failing close must not hold up the others.
    try {
      if ((await closeRegistration(db, id, now, null)).ok) closed++;
    } catch (error) {
      console.error(`[jobs] close-registrations: closing tournament ${id} failed`, error);
    }
  }
  return { closed };
}
