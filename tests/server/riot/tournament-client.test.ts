import { expect, test } from "bun:test";
import { createRiotTournamentClient } from "../../../src/server/riot/tournament-client";

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };

function stubFetch(replies: Reply[]) {
  const calls: { url: string; method: string; headers: Headers; body: unknown }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: reply.headers });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const noSleep = async () => {};

test("stub mode registers the provider on the stub API with the key", async () => {
  const stub = stubFetch([{ status: 200, body: 17 }]);
  const client = createRiotTournamentClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep, stub: true });
  expect(await client.registerProvider("https://gorosei.gg/api/riot/callback/s")).toEqual({ ok: true, data: 17 });
  expect(stub.calls[0]).toMatchObject({
    url: "https://americas.api.riotgames.com/lol/tournament-stub/v5/providers",
    method: "POST",
    body: { region: "LAS", url: "https://gorosei.gg/api/riot/callback/s" },
  });
  expect(stub.calls[0]!.headers.get("X-Riot-Token")).toBe("k");
});

test("real mode uses the tournament API", async () => {
  const stub = stubFetch([{ status: 200, body: 5 }]);
  const client = createRiotTournamentClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep, stub: false });
  expect(await client.createTournament(17, "Copa #3")).toEqual({ ok: true, data: 5 });
  expect(stub.calls[0]).toMatchObject({
    url: "https://americas.api.riotgames.com/lol/tournament/v5/tournaments",
    body: { name: "Copa #3", providerId: 17 },
  });
});

test("createCodes asks for a 5v5 Summoner's Rift code with the match as metadata", async () => {
  const stub = stubFetch([{ status: 200, body: ["LA2-CODE"] }]);
  const client = createRiotTournamentClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep, stub: false });
  expect(await client.createCodes(5, 1, { pickType: "TOURNAMENT_DRAFT", metadata: "match-1" })).toEqual({ ok: true, data: ["LA2-CODE"] });
  const url = new URL(stub.calls[0]!.url);
  expect(url.pathname).toBe("/lol/tournament/v5/codes");
  expect(url.searchParams.get("tournamentId")).toBe("5");
  expect(url.searchParams.get("count")).toBe("1");
  expect(stub.calls[0]!.body).toMatchObject({
    mapType: "SUMMONERS_RIFT",
    pickType: "TOURNAMENT_DRAFT",
    spectatorType: "ALL",
    teamSize: 5,
    metadata: "match-1",
  });
});

test("a rate limit is retried", async () => {
  const stub = stubFetch([{ status: 429, headers: { "Retry-After": "0" } }, { status: 200, body: 9 }]);
  const client = createRiotTournamentClient({ apiKey: "k", fetch: stub.fetch, sleep: noSleep, stub: true });
  expect(await client.registerProvider("https://x")).toEqual({ ok: true, data: 9 });
  expect(stub.calls).toHaveLength(2);
});
