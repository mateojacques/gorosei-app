import { and, eq, sql } from "drizzle-orm";
import type { Rank } from "../../shared/rank";
import type { Db } from "../db/client";
import { riotAccounts } from "../db/schema";
import { getCurrentRank, getSeasonPeak } from "./ranks";

export type PublicProfile = {
  gameName: string;
  tagLine: string;
  profileIconId: number;
  summonerLevel: number;
  currentRank: Rank | null;
  seasonPeak: Rank | null;
  // Filled in by Plan 3 (teams and tournaments).
  teams: [];
  tournaments: [];
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

  const [currentRank, seasonPeak] = await Promise.all([getCurrentRank(db, account.id), getSeasonPeak(db, account.id)]);
  return {
    gameName: account.gameName,
    tagLine: account.tagLine,
    profileIconId: account.profileIconId,
    summonerLevel: account.summonerLevel,
    currentRank,
    seasonPeak,
    teams: [],
    tournaments: [],
  };
}
