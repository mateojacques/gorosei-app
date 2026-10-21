import type { Rank } from "../../shared/rank";

export type RiotError = "not_found" | "rate_limited" | "unavailable";
export type RiotResult<T> = { ok: true; data: T } | { ok: false; error: RiotError };

export type RiotAccount = { puuid: string; gameName: string; tagLine: string };
export type RiotSummoner = { profileIconId: number; summonerLevel: number };
export type RiotSoloRank = Rank & { wins: number; losses: number };

export interface RiotClient {
  getAccountByRiotId(gameName: string, tagLine: string): Promise<RiotResult<RiotAccount>>;
  getSummonerByPuuid(puuid: string): Promise<RiotResult<RiotSummoner>>;
  getSoloRankByPuuid(puuid: string): Promise<RiotResult<RiotSoloRank | null>>;
}
