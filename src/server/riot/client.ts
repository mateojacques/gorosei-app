import { isDivision, isTier } from "../../shared/rank";
import type { RiotClient, RiotResult, RiotSoloRank } from "./types";

const REGIONAL_HOST = "https://americas.api.riotgames.com";
const PLATFORM_HOST = "https://la2.api.riotgames.com";
const SOLO_QUEUE = "RANKED_SOLO_5x5";
const BASE_BACKOFF_MS = 250;

type LeagueEntry = {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
};

export type RiotClientOptions = {
  apiKey: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
};

export function createRiotClient(opts: RiotClientOptions): RiotClient {
  const doFetch = opts.fetch ?? fetch;
  const maxRetries = opts.maxRetries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms));

  async function get<T>(url: string): Promise<RiotResult<T>> {
    let failure: "rate_limited" | "unavailable" = "unavailable";
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      let res: Response;
      try {
        res = await doFetch(url, { headers: { "X-Riot-Token": opts.apiKey } });
      } catch {
        failure = "unavailable";
        if (attempt < maxRetries) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      if (res.ok) return { ok: true, data: (await res.json()) as T };
      if (res.status === 404) return { ok: false, error: "not_found" };
      if (res.status === 429) {
        failure = "rate_limited";
        const retryAfterSeconds = Number(res.headers.get("Retry-After") ?? 1);
        if (attempt < maxRetries) await sleep(retryAfterSeconds * 1000);
        continue;
      }
      if (res.status >= 500) {
        failure = "unavailable";
        if (attempt < maxRetries) await sleep(BASE_BACKOFF_MS * 2 ** attempt);
        continue;
      }
      // Other 4xx (bad key, forbidden) are not retryable.
      return { ok: false, error: "unavailable" };
    }
    return { ok: false, error: failure };
  }

  return {
    getAccountByRiotId: async (gameName, tagLine) => {
      const result = await get<{ puuid: string; gameName: string; tagLine: string }>(
        `${REGIONAL_HOST}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
      );
      if (!result.ok) return result;
      const { puuid, gameName: name, tagLine: tag } = result.data;
      return { ok: true, data: { puuid, gameName: name, tagLine: tag } };
    },

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
