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
