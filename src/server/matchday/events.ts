import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { matches, registrations } from "../db/schema";
import { publish } from "../realtime/hub";

/** Pushes a "something changed" event for a tournament. Events carry no private data; clients refetch. */
export function announceTournament(tournamentId: string): void {
  publish({ channel: `tournament:${tournamentId}`, type: "updated" });
}

/** Called after the transaction commits. Failures are logged, never thrown. */
export async function announceMatch(db: Db, matchId: string): Promise<void> {
  try {
    const [match] = await db
      .select({ tournamentId: matches.tournamentId, status: matches.status })
      .from(matches)
      .where(eq(matches.id, matchId));
    if (!match) return;
    publish({ channel: `match:${matchId}`, type: "updated", data: { status: match.status } });
    publish({ channel: `tournament:${match.tournamentId}`, type: "updated" });
    publish({ channel: "console", type: "queue" });
  } catch (error) {
    console.error("[realtime] announceMatch failed", error);
  }
}

export async function announceRegistration(db: Db, registrationId: string): Promise<void> {
  try {
    const [row] = await db.select({ tournamentId: registrations.tournamentId }).from(registrations).where(eq(registrations.id, registrationId));
    if (row) announceTournament(row.tournamentId);
  } catch (error) {
    console.error("[realtime] announceRegistration failed", error);
  }
}
