import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, matches, user } from "../../../src/server/db/schema";
import { getConsoleQueue } from "../../../src/server/bracket/bracket";
import { confirmMatch } from "../../../src/server/matchday/moderation";
import { reportResult } from "../../../src/server/matchday/reports";
import { attachRiotMatchIds, attachVerifiedRiotMatchIds } from "../../../src/server/matchday/stats";
import type { RiotMatch } from "../../../src/server/riot/types";
import { startedTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

beforeEach(resetTestDb);

/** A game where `winners` (side 100) beat `losers` (side 200). */
const game = (matchId: string, winners: string[], losers: string[]): RiotMatch => ({
  matchId,
  durationSeconds: 1800,
  winningTeamId: 100,
  teams: [
    { teamId: 100, win: true, bans: [] },
    { teamId: 200, win: false, bans: [] },
  ],
  players: [
    ...winners.map((id) => ({ puuid: `puuid-${id}`, teamId: 100 as const, championName: "Ahri", kills: 1, deaths: 1, assists: 1, role: "MIDDLE" })),
    ...losers.map((id) => ({ puuid: `puuid-${id}`, teamId: 200 as const, championName: "Zed", kills: 1, deaths: 1, assists: 1, role: "MIDDLE" })),
  ],
});

async function setup() {
  const { teams } = await startedTestTournament(2, { bracket: "single_elimination", finalsBestOf: 3 });
  const [match] = await testDb.select().from(matches).where(eq(matches.status, "open"));
  const a = teams.find((t) => t.registrationId === match!.reg1Id)!;
  const b = teams.find((t) => t.registrationId === match!.reg2Id)!;
  const riot = new FakeRiotClient();
  const mod = await createTestUser("mod");
  await testDb.update(user).set({ role: "moderator" }).where(eq(user.id, mod));
  return { match: match!, a, b, riot, deps: { db: testDb, riot }, mod };
}

const row = async (id: string) => (await testDb.select().from(matches).where(eq(matches.id, id)))[0]!;
const proof = { screenshotUrl: null, riotMatchIds: [] as string[] };

test("Riot games pre-fill the score and mark a decided match reported", async () => {
  const { match, a, b, riot, deps } = await setup();
  expect(match.bestOf).toBe(3);
  riot.addMatch(game("LA2_1", a.starters, b.starters)).addMatch(game("LA2_2", a.starters, b.starters));

  expect(await attachVerifiedRiotMatchIds(deps, null, match.id, ["LA2_1"])).toEqual({ ok: true });
  expect(await row(match.id)).toMatchObject({ riotScore: { score1: 1, score2: 0 }, status: "open" });

  expect(await attachVerifiedRiotMatchIds(deps, null, match.id, ["LA2_2"])).toEqual({ ok: true });
  expect(await row(match.id)).toMatchObject({ riotScore: { score1: 2, score2: 0 }, status: "reported" });
  expect((await getConsoleQueue(testDb, new Date())).find((i) => i.matchId === match.id)?.kind).toBe("confirm");

  expect(await attachVerifiedRiotMatchIds(deps, null, match.id, ["LA2_2"])).toEqual({ ok: true });
  expect((await row(match.id)).riotScore).toEqual({ score1: 2, score2: 0 });
});

test("a game won on side 200 counts for the roster that played there", async () => {
  const { match, a, b, riot, deps } = await setup();
  riot.addMatch(game("LA2_1", b.starters, a.starters));
  await attachVerifiedRiotMatchIds(deps, null, match.id, ["LA2_1"]);
  expect((await row(match.id)).riotScore).toEqual({ score1: 0, score2: 1 });
});

test("a game of other players, or one not yet in match-v5, scores nothing", async () => {
  const { match, riot, deps } = await setup();
  riot.addMatch(game("LA2_9", ["x1", "x2", "x3", "x4", "x5"], ["y1", "y2", "y3", "y4", "y5"]));
  expect(await attachVerifiedRiotMatchIds(deps, null, match.id, ["LA2_9"])).toEqual({ ok: false, reason: "not_this_match" });
  expect(await attachVerifiedRiotMatchIds(deps, null, match.id, ["LA2_404"])).toEqual({ ok: false, reason: "invalid_id" });
  expect((await row(match.id)).riotScore).toBeNull();
});

test("confirming without a score uses the Riot result, even over conflicting reports", async () => {
  const { match, a, b, riot, deps, mod } = await setup();
  riot.addMatch(game("LA2_1", a.starters, b.starters)).addMatch(game("LA2_2", a.starters, b.starters));
  await attachVerifiedRiotMatchIds(deps, null, match.id, ["LA2_1", "LA2_2"]);
  await reportResult(testDb, a.captain, match.id, { own: 2, opponent: 0, ...proof });
  await reportResult(testDb, b.captain, match.id, { own: 2, opponent: 1, ...proof });
  expect((await row(match.id)).status).toBe("disputed");

  expect(await confirmMatch(testDb, mod, match.id)).toMatchObject({ ok: true });
  expect(await row(match.id)).toMatchObject({ status: "completed", score1: 2, score2: 0, winnerRegId: a.registrationId });
  const [audit] = await testDb.select().from(auditLog).where(eq(auditLog.action, "match.confirmed"));
  expect(audit!.data).toMatchObject({ source: "riot", score1: 2, score2: 0 });
});

test("a Riot-decided match with no reports can be confirmed", async () => {
  const { match, a, b, riot, deps, mod } = await setup();
  riot.addMatch(game("LA2_1", a.starters, b.starters)).addMatch(game("LA2_2", a.starters, b.starters));
  await attachVerifiedRiotMatchIds(deps, null, match.id, ["LA2_1", "LA2_2"]);
  expect(await confirmMatch(testDb, mod, match.id)).toMatchObject({ ok: true });
});

test("captains attaching match IDs still need permission and do not score (fallback mode)", async () => {
  const { match, a, b, riot, deps } = await setup();
  await createTestUser("outsider");
  riot.addMatch(game("LA2_1", a.starters, b.starters));
  expect(await attachRiotMatchIds(deps, { id: "outsider", role: "player" }, match.id, ["LA2_1"])).toEqual({ ok: false, reason: "forbidden" });
  expect(await attachRiotMatchIds(deps, { id: a.captain, role: "player" }, match.id, ["LA2_1"])).toEqual({ ok: true });
  expect(await row(match.id)).toMatchObject({ riotScore: null, status: "open" });
});
