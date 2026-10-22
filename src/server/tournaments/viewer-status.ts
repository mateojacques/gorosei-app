import { and, countDistinct, eq, inArray, notInArray } from "drizzle-orm";
import type { RegistrationStatus } from "../../shared/tournament";
import type { Db } from "../db/client";
import { checkIns, entryPayments, poolEntries, registrationPlayers, registrations, riotAccounts, teams } from "../db/schema";

export type ViewerTournamentStatus = {
  riotLinked: boolean;
  inPool: boolean;
  registration: { teamName: string; teamSlug: string; starters: number; paid: number; status: RegistrationStatus } | null;
  checkedIn: boolean;
};

/** Where the signed-in player stands in one tournament. Reads only their own rows and their own roster's. */
export async function getViewerTournamentStatus(db: Db, userId: string, tournamentId: string): Promise<ViewerTournamentStatus> {
  const [[account], [entry], [onRoster], [checkIn]] = await Promise.all([
    db.select({ id: riotAccounts.id }).from(riotAccounts).where(eq(riotAccounts.userId, userId)),
    db
      .select({ active: poolEntries.active })
      .from(poolEntries)
      .where(and(eq(poolEntries.tournamentId, tournamentId), eq(poolEntries.userId, userId), eq(poolEntries.active, true))),
    db
      .select({ registrationId: registrations.id, status: registrations.status, teamName: teams.name, teamSlug: teams.slug })
      .from(registrationPlayers)
      .innerJoin(registrations, eq(registrations.id, registrationPlayers.registrationId))
      .innerJoin(teams, eq(teams.id, registrations.teamId))
      .where(
        and(
          eq(registrationPlayers.tournamentId, tournamentId),
          eq(registrationPlayers.userId, userId),
          eq(registrationPlayers.active, true),
          notInArray(registrations.status, ["withdrawn", "dropped"]),
        ),
      ),
    db
      .select({ userId: checkIns.userId })
      .from(checkIns)
      .where(and(eq(checkIns.tournamentId, tournamentId), eq(checkIns.userId, userId))),
  ]);

  let registration: ViewerTournamentStatus["registration"] = null;
  if (onRoster) {
    const roster = await db
      .select({ userId: registrationPlayers.userId, isSub: registrationPlayers.isSub })
      .from(registrationPlayers)
      .where(and(eq(registrationPlayers.registrationId, onRoster.registrationId), eq(registrationPlayers.active, true)));
    const [paid] = await db
      .select({ n: countDistinct(entryPayments.userId) })
      .from(entryPayments)
      .where(
        and(
          eq(entryPayments.tournamentId, tournamentId),
          eq(entryPayments.forfeited, false),
          inArray(entryPayments.userId, roster.map((p) => p.userId)),
        ),
      );
    registration = {
      teamName: onRoster.teamName,
      teamSlug: onRoster.teamSlug,
      starters: roster.filter((p) => !p.isSub).length,
      paid: paid?.n ?? 0,
      status: onRoster.status,
    };
  }
  return { riotLinked: !!account, inPool: !!entry, registration, checkedIn: !!checkIn };
}
