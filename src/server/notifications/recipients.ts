import { and, eq } from "drizzle-orm";
import type { TournamentRef } from "../../shared/notifications";
import { formatRiotId } from "../../shared/riot-id";
import type { Executor } from "../db/client";
import { registrationPlayers, registrations, riotAccounts, teams, tournaments } from "../db/schema";

export async function tournamentRef(tx: Executor, tournamentId: string): Promise<TournamentRef> {
  const [row] = await tx
    .select({ title: tournaments.title, edition: tournaments.edition, slug: tournaments.slug })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId));
  if (!row) throw new Error(`tournament ${tournamentId} not found`);
  return row;
}

/** The registration's active players, starters and subs. */
export async function rosterUserIds(tx: Executor, registrationId: string): Promise<string[]> {
  const rows = await tx
    .select({ userId: registrationPlayers.userId })
    .from(registrationPlayers)
    .where(and(eq(registrationPlayers.registrationId, registrationId), eq(registrationPlayers.active, true)));
  return rows.map((r) => r.userId);
}

export async function captainOf(tx: Executor, registrationId: string): Promise<string | null> {
  const [row] = await tx
    .select({ captainUserId: teams.captainUserId })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(eq(registrations.id, registrationId));
  return row?.captainUserId ?? null;
}

export async function teamNameOf(tx: Executor, registrationId: string): Promise<string> {
  const [row] = await tx
    .select({ name: teams.name })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(eq(registrations.id, registrationId));
  return row?.name ?? "";
}

/** "gameName#tagLine" of the user's linked account, or "" without one. */
export async function riotIdOf(tx: Executor, userId: string): Promise<string> {
  const [row] = await tx
    .select({ gameName: riotAccounts.gameName, tagLine: riotAccounts.tagLine })
    .from(riotAccounts)
    .where(eq(riotAccounts.userId, userId));
  return row ? formatRiotId(row) : "";
}
