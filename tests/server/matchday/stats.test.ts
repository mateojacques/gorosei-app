import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, matches } from "../../../src/server/db/schema";
import { attachRiotMatchIds } from "../../../src/server/matchday/stats";
import type { RiotMatch } from "../../../src/server/riot/types";
import { startedTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

beforeEach(resetTestDb);

const riotMatch = (matchId: string, team1: string[], team2: string[]): RiotMatch => ({
  matchId,
  durationSeconds: 1800,
  winningTeamId: 100,
  teams: [
    { teamId: 100, win: true, bans: [1, 2, 3, 4, 5] },
    { teamId: 200, win: false, bans: [6, 7, 8, 9, 10] },
  ],
  players: [
    ...team1.map((id) => ({ puuid: `puuid-${id}`, teamId: 100 as const, championName: "Ahri", kills: 3, deaths: 2, assists: 7, role: "MIDDLE" })),
    ...team2.map((id) => ({ puuid: `puuid-${id}`, teamId: 200 as const, championName: "Zed", kills: 1, deaths: 5, assists: 2, role: "MIDDLE" })),
  ],
});

async function setup() {
  const { teams } = await startedTestTournament(2, { bracket: "single_elimination", finalsBestOf: 1 });
  const [match] = await testDb.select().from(matches).where(eq(matches.status, "open"));
  const a = teams.find((t) => t.registrationId === match!.reg1Id)!;
  const b = teams.find((t) => t.registrationId === match!.reg2Id)!;
  const riot = new FakeRiotClient();
  const mod = await createTestUser("mod");
  return { match: match!, a, b, riot, deps: { db: testDb, riot }, mod, outsider: await createTestUser("out") };
}

test("a match with five players from each roster is stored", async () => {
  const { match, a, b, riot, deps } = await setup();
  riot.addMatch(riotMatch("LA2_100", a.starters, b.starters));
  expect(await attachRiotMatchIds(deps, { id: a.captain, role: "player" }, match.id, ["LA2_100"])).toEqual({ ok: true });
  const [row] = await testDb.select().from(matches).where(eq(matches.id, match.id));
  expect(row!.riotMatchIds).toEqual(["LA2_100"]);
  const stats = row!.stats as { players: { riotId: string | null }[] }[];
  expect(stats).toHaveLength(1);
  expect(stats[0]!.players.every((p) => p.riotId !== null)).toBe(true);
  expect((await testDb.select().from(auditLog).where(eq(auditLog.action, "match.stats_attached"))).length).toBe(1);
});

test("an ID with players from other rosters is not this match", async () => {
  const { match, a, b, riot, deps, mod } = await setup();
  riot.addMatch(riotMatch("LA2_200", a.starters.slice(0, 2), b.starters));
  expect(await attachRiotMatchIds(deps, { id: mod, role: "moderator" }, match.id, ["LA2_200"])).toEqual({ ok: false, reason: "not_this_match" });
  const [row] = await testDb.select().from(matches).where(eq(matches.id, match.id));
  expect(row!.stats).toBeNull();
});

test("LA1 IDs are invalid and unknown IDs are invalid too", async () => {
  const { match, a, deps } = await setup();
  const captain = { id: a.captain, role: "player" as const };
  expect(await attachRiotMatchIds(deps, captain, match.id, ["LA1_123"])).toEqual({ ok: false, reason: "invalid_id" });
  expect(await attachRiotMatchIds(deps, captain, match.id, ["LA2_999"])).toEqual({ ok: false, reason: "invalid_id" });
});

test("a Riot outage stores nothing", async () => {
  const { match, a, b, riot, deps } = await setup();
  riot.addMatch(riotMatch("LA2_300", a.starters, b.starters));
  riot.setUnavailable("LA2_300");
  expect(await attachRiotMatchIds(deps, { id: a.captain, role: "player" }, match.id, ["LA2_300"])).toEqual({ ok: false, reason: "riot_unavailable" });
  const [row] = await testDb.select().from(matches).where(eq(matches.id, match.id));
  expect(row!.riotMatchIds).toEqual([]);
});

test("outsiders and non-captain players are forbidden", async () => {
  const { match, a, b, riot, deps, outsider } = await setup();
  riot.addMatch(riotMatch("LA2_400", a.starters, b.starters));
  expect(await attachRiotMatchIds(deps, { id: outsider, role: "player" }, match.id, ["LA2_400"])).toEqual({ ok: false, reason: "forbidden" });
  expect(await attachRiotMatchIds(deps, { id: a.ids[2]!, role: "player" }, match.id, ["LA2_400"])).toEqual({ ok: false, reason: "forbidden" });
  expect(await attachRiotMatchIds(deps, { id: outsider, role: "player" }, crypto.randomUUID(), ["LA2_400"])).toEqual({ ok: false, reason: "not_found" });
});

test("re-attaching the same ID does not duplicate it or call Riot again", async () => {
  const { match, a, b, riot, deps } = await setup();
  riot.addMatch(riotMatch("LA2_500", a.starters, b.starters));
  const captain = { id: a.captain, role: "player" as const };
  await attachRiotMatchIds(deps, captain, match.id, ["LA2_500"]);
  expect(await attachRiotMatchIds(deps, captain, match.id, ["LA2_500"])).toEqual({ ok: true });
  const [row] = await testDb.select().from(matches).where(eq(matches.id, match.id));
  expect(row!.riotMatchIds).toEqual(["LA2_500"]);
  expect((row!.stats as unknown[]).length).toBe(1);
  expect(riot.matchCalls).toEqual(["LA2_500"]);
});
