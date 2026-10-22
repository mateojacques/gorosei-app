import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { matches, tournaments, user } from "../../../src/server/db/schema";
import { postMessage } from "../../../src/server/matchday/chat";
import { loadMatchPage } from "../../../src/server/matchday/match-page";
import { setMatchVod } from "../../../src/server/matchday/moderation";
import { postLobby, reportResult } from "../../../src/server/matchday/reports";
import { linkedPlayer, startedTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

const proof = { screenshotUrl: null, riotMatchIds: [] as string[] };

async function busyMatch() {
  await createTestUser("mod");
  await testDb.update(user).set({ role: "moderator" }).where(eq(user.id, "mod"));
  const s = await startedTestTournament(4, { bracket: "single_elimination" });
  const all = await testDb.select().from(matches).where(eq(matches.tournamentId, s.tournament.id));
  const m = all.find((x) => x.status === "open")!;
  const captain = (reg: string) => s.teams.find((t) => t.registrationId === reg)!.captain;
  expect((await postLobby(testDb, "mod", m.id, { name: "Sala", password: "secreta" })).ok).toBe(true);
  await reportResult(testDb, captain(m.reg1Id!), m.id, { own: 1, opponent: 0, ...proof });
  await reportResult(testDb, captain(m.reg2Id!), m.id, { own: 1, opponent: 0, ...proof });
  expect((await postMessage(testDb, { id: captain(m.reg1Id!), role: "player" }, m.id, "hola")).ok).toBe(true);
  await setMatchVod(testDb, "mod", m.id, "https://www.youtube.com/watch?v=abc");
  const waiting = all.find((x) => x.status === "waiting" && !x.reg1Id && !x.reg2Id)!;
  return { s, m, captain1: captain(m.reg1Id!), waiting };
}

const now = new Date();

test("signed-out visitors and outsiders get the public match only", async () => {
  const { m } = await busyMatch();
  await linkedPlayer("outsider");
  for (const viewer of [null, { userId: "outsider", role: "player" as const }]) {
    const page = (await loadMatchPage(testDb, m.id, viewer, now))!;
    expect(page.match.teams.every((team) => team !== null)).toBe(true);
    expect(page.match.vodUrl).toBe("https://www.youtube.com/watch?v=abc");
    expect(page.match.lobby).toBeNull();
    expect(page.match.reports).toEqual([]);
    expect(page.messages).toEqual([]);
    expect(page.captainSide).toBeNull();
    expect(page.canSeePrivate).toBe(false);
    expect(page.viewer).toEqual(viewer);
    expect(JSON.stringify(page)).not.toContain("secreta");
    expect(JSON.stringify(page)).not.toContain("@test.local");
  }
});

test("captains and moderators still get lobby, reports and chat", async () => {
  const { m, captain1 } = await busyMatch();
  const asCaptain = (await loadMatchPage(testDb, m.id, { userId: captain1, role: "player" }, now))!;
  expect(asCaptain.match.lobby).toEqual({ name: "Sala", password: "secreta" });
  expect(asCaptain.match.reports).toHaveLength(2);
  expect(asCaptain.messages.map((x) => x.body)).toContain("hola");
  expect(asCaptain.captainSide).toBe(0);
  expect(asCaptain.canSeePrivate).toBe(true);
  const asMod = (await loadMatchPage(testDb, m.id, { userId: "mod", role: "moderator" }, now))!;
  expect(asMod.match.lobby).not.toBeNull();
  expect(asMod.messages.length).toBeGreaterThan(0);
  expect(asMod.captainSide).toBeNull();
});

test("no page for a match without teams, a draft tournament or a bad id", async () => {
  const { s, m, waiting } = await busyMatch();
  expect(await loadMatchPage(testDb, waiting.id, null, now)).toBeNull();
  expect(await loadMatchPage(testDb, crypto.randomUUID(), null, now)).toBeNull();
  expect(await loadMatchPage(testDb, "not-a-uuid", null, now)).toBeNull();
  await testDb.update(tournaments).set({ status: "draft" }).where(eq(tournaments.id, s.tournament.id));
  expect(await loadMatchPage(testDb, m.id, { userId: "mod", role: "moderator" }, now)).toBeNull();
});

test("the public match page never carries Riot PUUIDs", async () => {
  const { m, captain1 } = await busyMatch();
  const stats = [
    {
      matchId: "LA2_1",
      durationSeconds: 1800,
      winningTeamId: 100,
      teams: [],
      players: [{ puuid: "secret-puuid-1", teamId: 100, championName: "Ahri", kills: 1, deaths: 0, assists: 2, role: "MIDDLE", riotId: "Uno#LAS" }],
    },
  ];
  await testDb.update(matches).set({ stats }).where(eq(matches.id, m.id));
  for (const viewer of [null, { userId: captain1, role: "player" as const }]) {
    const page = (await loadMatchPage(testDb, m.id, viewer, now))!;
    expect(page.match.stats![0]!.players[0]!.riotId).toBe("Uno#LAS");
    expect(JSON.stringify(page)).not.toContain("secret-puuid-1");
  }
});
