import type { Rank } from "../../shared/rank";

export type RiotError = "not_found" | "rate_limited" | "unavailable";
export type RiotResult<T> = { ok: true; data: T } | { ok: false; error: RiotError };

export type RiotAccount = { puuid: string; gameName: string; tagLine: string };
export type RiotSummoner = { profileIconId: number; summonerLevel: number };
export type RiotSoloRank = Rank & { wins: number; losses: number };

export type RiotMatch = {
  matchId: string;
  durationSeconds: number;
  winningTeamId: 100 | 200;
  teams: { teamId: 100 | 200; win: boolean; bans: number[] }[];
  players: {
    puuid: string;
    teamId: 100 | 200;
    championName: string;
    kills: number;
    deaths: number;
    assists: number;
    role: string;
  }[];
};

export interface RiotClient {
  getAccountByRiotId(gameName: string, tagLine: string): Promise<RiotResult<RiotAccount>>;
  getAccountByPuuid(puuid: string): Promise<RiotResult<RiotAccount>>;
  getAccountByAccessToken(accessToken: string): Promise<RiotResult<RiotAccount>>;
  getSummonerByPuuid(puuid: string): Promise<RiotResult<RiotSummoner>>;
  getSoloRankByPuuid(puuid: string): Promise<RiotResult<RiotSoloRank | null>>;
  getMatch(matchId: string): Promise<RiotResult<RiotMatch>>;
}
