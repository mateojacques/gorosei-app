import { and, desc, eq, sql } from "drizzle-orm";
import type { Rank } from "../../shared/rank";
import type { Db } from "../db/client";
import { registrationPlayers, registrations, riotAccounts, teamMembers, teams, tournaments } from "../db/schema";
import { getCurrentRank, getSeasonPeak } from "./ranks";

export type PublicProfile = {
  gameName: string;
  tagLine: string;
  profileIconId: number;
  summonerLevel: number;
  currentRank: Rank | null;
  seasonPeak: Rank | null;
  teams: { name: string; tag: string; slug: string }[];
  /** Confirmed registrations, newest tournament first. */
  tournaments: { title: string; edition: number; slug: string; startsAt: Date; teamName: string }[];
};

export async function getPublicProfile(db: Db, gameName: string, tagLine: string): Promise<PublicProfile | null> {
  const [account] = await db
    .select()
    .from(riotAccounts)
    .where(
      and(
        eq(sql`lower(${riotAccounts.gameName})`, gameName.toLowerCase()),
        eq(sql`lower(${riotAccounts.tagLine})`, tagLine.toLowerCase()),
      ),
    );
  if (!account) return null;

  const [currentRank, seasonPeak, playerTeams, playedTournaments] = await Promise.all([
    getCurrentRank(db, account.id),
    getSeasonPeak(db, account.id),
    db
      .select({ name: teams.name, tag: teams.tag, slug: teams.slug })
      .from(teamMembers)
      .innerJoin(teams, eq(teams.id, teamMembers.teamId))
      .where(eq(teamMembers.userId, account.userId))
      .orderBy(teams.name),
    db
      .select({
        title: tournaments.title,
        edition: tournaments.edition,
        slug: tournaments.slug,
        startsAt: tournaments.startsAt,
        teamName: teams.name,
      })
      .from(registrationPlayers)
      .innerJoin(registrations, eq(registrations.id, registrationPlayers.registrationId))
      .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
      .innerJoin(teams, eq(teams.id, registrations.teamId))
      .where(
        and(
          eq(registrationPlayers.userId, account.userId),
          eq(registrationPlayers.active, true),
          eq(registrations.status, "confirmed"),
        ),
      )
      .orderBy(desc(tournaments.startsAt)),
  ]);
  return {
    gameName: account.gameName,
    tagLine: account.tagLine,
    profileIconId: account.profileIconId,
    summonerLevel: account.summonerLevel,
    currentRank,
    seasonPeak,
    teams: playerTeams,
    tournaments: playedTournaments,
  };
}
