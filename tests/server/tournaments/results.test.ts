import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { brackets, matches, tournaments } from "../../../src/server/db/schema";
import { getNextTournament, getTournamentResults } from "../../../src/server/tournaments/results";
import { createTestTournament, startedTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

async function finishedWith(standings: { index: number; rank: number }[] | null) {
  const started = await startedTestTournament(4);
  await testDb.update(tournaments).set({ status: "finished" }).where(eq(tournaments.id, started.tournament.id));
  if (standings) {
    await testDb
      .update(brackets)
      .set({ finalStandings: standings.map((s) => ({ registrationId: started.teams[s.index]!.registrationId, rank: s.rank })) })
      .where(eq(brackets.tournamentId, started.tournament.id));
  }
  return started;
}

test("a finished tournament has a champion and a podium with prizes", async () => {
  const { tournament, teams } = await finishedWith([
    { index: 2, rank: 1 },
    { index: 0, rank: 2 },
    { index: 1, rank: 3 },
    { index: 3, rank: 4 },
  ]);
  const results = await getTournamentResults(testDb, tournament.id, [210000, 90000]);
  expect(results!.champion!.registrationId).toBe(teams[2]!.registrationId);
  expect(results!.champion!.teamName).toBeTruthy();
  expect(results!.champion!.teamSlug).toBeTruthy();
  expect(results!.podium.map((p) => [p.rank, p.team.registrationId, p.prizeArs])).toEqual([
    [1, teams[2]!.registrationId, 210000],
    [2, teams[0]!.registrationId, 90000],
    [3, teams[1]!.registrationId, null],
  ]);
  expect(results!.vods).toEqual([]);
});

test("standings with only two ranks give a podium of two", async () => {
  const { tournament } = await finishedWith([
    { index: 0, rank: 1 },
    { index: 1, rank: 2 },
  ]);
  const results = await getTournamentResults(testDb, tournament.id, [300000]);
  expect(results!.podium.map((p) => [p.rank, p.prizeArs])).toEqual([
    [1, 300000],
    [2, null],
  ]);
});

test("finished without standings has no champion, never an invented one", async () => {
  const { tournament } = await finishedWith(null);
  expect(await getTournamentResults(testDb, tournament.id, [1])).toEqual({ champion: null, podium: [], vods: [] });
});

test("live and cancelled tournaments have no results", async () => {
  const live = await createTestTournament({ status: "live" });
  const cancelled = await createTestTournament({ status: "cancelled" });
  expect(await getTournamentResults(testDb, live.id, [1])).toBeNull();
  expect(await getTournamentResults(testDb, cancelled.id, [1])).toBeNull();
  expect(await getTournamentResults(testDb, crypto.randomUUID(), [1])).toBeNull();
});

const at = (day: number) => ({
  startsAt: new Date(Date.UTC(2026, 10, day, 20)),
  registrationClosesAt: new Date(Date.UTC(2026, 10, day, 10)),
});

test("next cup is the earliest later public tournament still to be played", async () => {
  const current = await createTestTournament({ status: "finished", ...at(5) });
  await createTestTournament({ status: "draft", ...at(6) });
  await createTestTournament({ status: "cancelled", ...at(7) });
  await createTestTournament({ status: "finished", ...at(8) });
  await createTestTournament({ status: "registration_open", ...at(4) });
  const later = await createTestTournament({ status: "registration_open", ...at(12) });
  const sooner = await createTestTournament({ status: "registration_closed", ...at(10) });
  const next = await getNextTournament(testDb, { id: current.id, startsAt: current.startsAt });
  expect(next).toEqual({ slug: sooner.slug, title: sooner.title, edition: sooner.edition, startsAt: sooner.startsAt });
  expect(later.slug).not.toBe(next!.slug);
});

test("no later cup → null", async () => {
  const current = await createTestTournament({ status: "finished", ...at(5) });
  await createTestTournament({ status: "draft", ...at(9) });
  expect(await getNextTournament(testDb, { id: current.id, startsAt: current.startsAt })).toBeNull();
});

test("vods list matches with a stored link, by round then number, with team names", async () => {
  const { tournament } = await finishedWith([{ index: 0, rank: 1 }]);
  const all = await testDb.select().from(matches).where(eq(matches.tournamentId, tournament.id));
  const withTeams = all.filter((m) => m.reg1Id && m.reg2Id).sort((a, b) => b.roundNo - a.roundNo || b.number - a.number);
  const empty = all.find((m) => !m.reg1Id || !m.reg2Id);
  for (const [i, m] of withTeams.entries()) {
    await testDb.update(matches).set({ vodUrl: `https://example.com/vod/${i}` }).where(eq(matches.id, m.id));
  }
  if (empty) await testDb.update(matches).set({ vodUrl: "https://example.com/vod/empty" }).where(eq(matches.id, empty.id));
  const results = (await getTournamentResults(testDb, tournament.id, [1]))!;
  const expected = [...withTeams, ...(empty ? [empty] : [])].sort((a, b) => a.roundNo - b.roundNo || a.number - b.number || a.groupNo - b.groupNo);
  expect(results.vods.map((v) => v.matchId)).toEqual(expected.map((m) => m.id));
  for (const v of results.vods) {
    const m = expected.find((x) => x.id === v.matchId)!;
    expect(v.teams[0] === "").toBe(!m.reg1Id);
    expect(v.teams[1] === "").toBe(!m.reg2Id);
    expect(v.url.startsWith("https://example.com/vod/")).toBe(true);
  }
});
