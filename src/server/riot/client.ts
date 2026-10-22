import { isDivision, isTier } from "../../shared/rank";
import { type RiotHttpOptions, riotRequest } from "./http";
import type { RiotAccount, RiotClient, RiotMatch, RiotResult, RiotSoloRank } from "./types";

const REGIONAL_HOST = "https://americas.api.riotgames.com";
const PLATFORM_HOST = "https://la2.api.riotgames.com";
const SOLO_QUEUE = "RANKED_SOLO_5x5";

type LeagueEntry = {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};

type MatchPayload = {
  metadata: { matchId: string };
  info: {
    gameDuration: number;
    teams: { teamId: number; win: boolean; bans: { championId: number }[] }[];
    participants: {
      puuid: string;
      teamId: number;
      championName: string;
      kills: number;
      deaths: number;
      assists: number;
      teamPosition: string;
    }[];
  };
};

const teamId = (id: number): 100 | 200 => (id === 200 ? 200 : 100);

export type RiotClientOptions = RiotHttpOptions & { apiKey: string };

export function createRiotClient(opts: RiotClientOptions): RiotClient {
  const get = <T>(url: string) => riotRequest<T>(opts, "GET", url, { headers: { "X-Riot-Token": opts.apiKey } });

  const toAccount = (result: RiotResult<RiotAccount>): RiotResult<RiotAccount> => {
    if (!result.ok) return result;
    const { puuid, gameName, tagLine } = result.data;
    return { ok: true, data: { puuid, gameName, tagLine } };
  };
  const getAccount = async (path: string) => toAccount(await get<RiotAccount>(`${REGIONAL_HOST}/riot/account/v1/accounts/${path}`));

  return {
    getAccountByRiotId: (gameName, tagLine) =>
      getAccount(`by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`),

    getAccountByPuuid: (puuid) => getAccount(`by-puuid/${encodeURIComponent(puuid)}`),

    // Riot Sign On: the account behind a player access token; the API key is not sent.
    getAccountByAccessToken: async (accessToken) =>
      toAccount(
        await riotRequest<RiotAccount>(opts, "GET", `${REGIONAL_HOST}/riot/account/v1/accounts/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ),

    getSummonerByPuuid: async (puuid) => {
      const result = await get<{ profileIconId: number; summonerLevel: number }>(
        `${PLATFORM_HOST}/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(puuid)}`,
      );
      if (!result.ok) return result;
      const { profileIconId, summonerLevel } = result.data;
      return { ok: true, data: { profileIconId, summonerLevel } };
    },

    getSoloRankByPuuid: async (puuid) => {
      const result = await get<LeagueEntry[]>(
        `${PLATFORM_HOST}/lol/league/v4/entries/by-puuid/${encodeURIComponent(puuid)}`,
      );
      if (!result.ok) return result;
      return { ok: true, data: toSoloRank(result.data.find((e) => e.queueType === SOLO_QUEUE)) };
    },

    getMatch: async (matchId) => {
      const result = await get<MatchPayload>(`${REGIONAL_HOST}/lol/match/v5/matches/${encodeURIComponent(matchId)}`);
      if (!result.ok) return result;
      const { metadata, info } = result.data;
      const teams = info.teams.map((t) => ({ teamId: teamId(t.teamId), win: t.win, bans: t.bans.map((b) => b.championId) }));
      const match: RiotMatch = {
        matchId: metadata.matchId,
        durationSeconds: info.gameDuration,
        winningTeamId: teams.find((t) => t.win)?.teamId ?? 100,
        teams,
        players: info.participants.map((p) => ({
          puuid: p.puuid,
          teamId: teamId(p.teamId),
          championName: p.championName,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          role: p.teamPosition,
        })),
      };
      return { ok: true, data: match };
    },
  };
}

function toSoloRank(entry: LeagueEntry | undefined): RiotSoloRank | null {
  if (!entry || !isTier(entry.tier) || !isDivision(entry.rank)) return null;
  return {
    tier: entry.tier,
    division: entry.rank,
    lp: entry.leaguePoints,
    wins: entry.wins,
    losses: entry.losses,
  };
}
