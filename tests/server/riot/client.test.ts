import { expect, test } from "bun:test";
import { createRiotClient } from "../../../src/server/riot/client";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function stubFetch(replies: Reply[]) {
  const calls: { url: string; headers: Headers }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: reply.headers,
    });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const noSleep = async () => {};
const account = { puuid: "p1", gameName: "Señor Café", tagLine: "LAS" };

test("getAccountByRiotId URL-encodes the Riot ID and sends the API key", async () => {
  const stub = stubFetch([{ status: 200, body: account }]);
  const riot = createRiotClient({ apiKey: "key-1", fetch: stub.fetch, sleep: noSleep });

  const result = await riot.getAccountByRiotId("Señor Café", "LAS");

  expect(result).toEqual({ ok: true, data: account });
  expect(stub.calls[0]!.url).toBe(
    "https://americas.api.riotgames.com/riot/account/v1/accounts/by-riot-id/Se%C3%B1or%20Caf%C3%A9/LAS",
  );
  expect(stub.calls[0]!.headers.get("X-Riot-Token")).toBe("key-1");
});

test("404 maps to not_found", async () => {
  const stub = stubFetch([{ status: 404, body: { status: { status_code: 404 } } }]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep });

  expect(await riot.getAccountByRiotId("nobody", "LAS")).toEqual({ ok: false, error: "not_found" });
});

test("429 honors Retry-After and then succeeds", async () => {
  const stub = stubFetch([
    { status: 429, headers: { "Retry-After": "0" } },
    { status: 200, body: account },
  ]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch });

  expect(await riot.getAccountByRiotId("Señor Café", "LAS")).toEqual({ ok: true, data: account });
  expect(stub.calls).toHaveLength(2);
});

test("429 waits the Retry-After seconds before retrying", async () => {
  const waits: number[] = [];
  const stub = stubFetch([
    { status: 429, headers: { "Retry-After": "3" } },
    { status: 200, body: account },
  ]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, sleep: async (ms) => void waits.push(ms) });

  await riot.getAccountByRiotId("Señor Café", "LAS");

  expect(waits).toEqual([3000]);
});

test("429 beyond maxRetries is rate_limited", async () => {
  const stub = stubFetch([{ status: 429, headers: { "Retry-After": "0" } }]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, maxRetries: 2, sleep: noSleep });

  expect(await riot.getAccountByRiotId("x", "LAS")).toEqual({ ok: false, error: "rate_limited" });
  expect(stub.calls).toHaveLength(3);
});

test("503 is unavailable after retries", async () => {
  const stub = stubFetch([{ status: 503 }]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep });

  expect(await riot.getAccountByRiotId("x", "LAS")).toEqual({ ok: false, error: "unavailable" });
  expect(stub.calls).toHaveLength(4);
});

test("network errors are unavailable", async () => {
  const fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof globalThis.fetch;
  const riot = createRiotClient({ apiKey: "k", fetch, sleep: noSleep });

  expect(await riot.getAccountByRiotId("x", "LAS")).toEqual({ ok: false, error: "unavailable" });
});

test("getSummonerByPuuid reads icon and level from LAS", async () => {
  const stub = stubFetch([{ status: 200, body: { puuid: "p1", profileIconId: 12, summonerLevel: 345 } }]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep });

  expect(await riot.getSummonerByPuuid("p1")).toEqual({ ok: true, data: { profileIconId: 12, summonerLevel: 345 } });
  expect(stub.calls[0]!.url).toBe("https://la2.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/p1");
});

test("getSoloRankByPuuid picks the solo queue entry", async () => {
  const stub = stubFetch([
    {
      status: 200,
      body: [
        { queueType: "RANKED_FLEX_SR", tier: "CHALLENGER", rank: "I", leaguePoints: 900, wins: 1, losses: 0 },
        { queueType: "RANKED_SOLO_5x5", tier: "GOLD", rank: "II", leaguePoints: 40, wins: 10, losses: 8 },
      ],
    },
  ]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep });

  expect(await riot.getSoloRankByPuuid("p1")).toEqual({
    ok: true,
    data: { tier: "GOLD", division: "II", lp: 40, wins: 10, losses: 8 },
  });
  expect(stub.calls[0]!.url).toBe("https://la2.api.riotgames.com/lol/league/v4/entries/by-puuid/p1");
});

test("getSoloRankByPuuid returns null for unranked players", async () => {
  const stub = stubFetch([
    { status: 200, body: [{ queueType: "RANKED_FLEX_SR", tier: "GOLD", rank: "I", leaguePoints: 0, wins: 1, losses: 0 }] },
  ]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep });

  expect(await riot.getSoloRankByPuuid("p1")).toEqual({ ok: true, data: null });
});

test("getAccountByPuuid reads the current Riot ID", async () => {
  const stub = stubFetch([{ status: 200, body: account }]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep });

  expect(await riot.getAccountByPuuid("p1")).toEqual({ ok: true, data: account });
  expect(stub.calls[0]!.url).toBe("https://americas.api.riotgames.com/riot/account/v1/accounts/by-puuid/p1");
});

test("getMatch hits the americas host and maps the match-v5 payload", async () => {
  const stub = stubFetch([
    {
      status: 200,
      body: {
        metadata: { matchId: "LA2_123" },
        info: {
          gameDuration: 1805,
          teams: [
            { teamId: 100, win: false, bans: [{ championId: 1 }, { championId: 2 }] },
            { teamId: 200, win: true, bans: [{ championId: 3 }] },
          ],
          participants: [
            { puuid: "a", teamId: 100, championName: "Ahri", kills: 3, deaths: 4, assists: 5, teamPosition: "MIDDLE", extra: 1 },
            { puuid: "b", teamId: 200, championName: "Zed", kills: 9, deaths: 1, assists: 2, teamPosition: "MIDDLE" },
          ],
        },
      },
    },
  ]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep });

  expect(await riot.getMatch("LA2_123")).toEqual({
    ok: true,
    data: {
      matchId: "LA2_123",
      durationSeconds: 1805,
      winningTeamId: 200,
      teams: [
        { teamId: 100, win: false, bans: [1, 2] },
        { teamId: 200, win: true, bans: [3] },
      ],
      players: [
        { puuid: "a", teamId: 100, championName: "Ahri", kills: 3, deaths: 4, assists: 5, role: "MIDDLE" },
        { puuid: "b", teamId: 200, championName: "Zed", kills: 9, deaths: 1, assists: 2, role: "MIDDLE" },
      ],
    },
  });
  expect(stub.calls[0]!.url).toBe("https://americas.api.riotgames.com/lol/match/v5/matches/LA2_123");
});

test("getMatch maps 404 to not_found", async () => {
  const stub = stubFetch([{ status: 404 }]);
  const riot = createRiotClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep });
  expect(await riot.getMatch("LA2_1")).toEqual({ ok: false, error: "not_found" });
});

test("getAccountByAccessToken uses the player's token, not the API key", async () => {
  const stub = stubFetch([{ status: 200, body: account }]);
  const riot = createRiotClient({ apiKey: "key-1", fetch: stub.fetch, sleep: noSleep });
  expect(await riot.getAccountByAccessToken("tok")).toEqual({ ok: true, data: account });
  expect(stub.calls[0]!.url).toBe("https://americas.api.riotgames.com/riot/account/v1/accounts/me");
  expect(stub.calls[0]!.headers.get("Authorization")).toBe("Bearer tok");
  expect(stub.calls[0]!.headers.get("X-Riot-Token")).toBeNull();
});
