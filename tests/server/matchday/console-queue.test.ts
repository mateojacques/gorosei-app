import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { getConsoleQueue } from "../../../src/server/bracket/bracket";
import { matchReports, matches, tournaments } from "../../../src/server/db/schema";
import { startedTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

const T0 = new Date("2026-11-01T19:55:00Z");
const minutes = (n: number) => new Date(T0.getTime() + n * 60_000);

async function fourTeamMatches() {
  const s = await startedTestTournament(4, { bracket: "single_elimination" });
  const rows = (await testDb.select().from(matches).where(eq(matches.tournamentId, s.tournament.id))).filter((m) => m.status === "open");
  return { s, rows };
}

const report = (matchId: string, registrationId: string, at: Date) =>
  testDb.insert(matchReports).values({ matchId, registrationId, score1: 1, score2: 0, createdAt: at, updatedAt: at });

test("orders disputes, results to confirm, lobbies and late matches, oldest first", async () => {
  const { s, rows } = await fourTeamMatches();
  const [m1, m2] = rows as [(typeof rows)[number], (typeof rows)[number]];
  // m1 is disputed, m2 waits for a lobby: the queue puts the dispute first.
  await testDb.update(matches).set({ status: "disputed", openedAt: minutes(-90) }).where(eq(matches.id, m1.id));
  await report(m1.id, m1.reg1Id!, minutes(-5));
  await report(m1.id, m1.reg2Id!, minutes(-4));
  let queue = await getConsoleQueue(testDb, minutes(0));
  expect(queue.map((i) => [i.kind, i.matchId])).toEqual([["dispute", m1.id], ["lobby", m2.id]]);
  expect(queue[0]).toMatchObject({ reportCount: 2, tournamentSlug: s.tournament.slug, round: 1 });
  expect(queue[0]!.teams).toHaveLength(2);

  // m2 now has one report: it becomes a result to confirm.
  await testDb.update(matches).set({ status: "in_progress" }).where(eq(matches.id, m2.id));
  await report(m2.id, m2.reg1Id!, minutes(-10));
  queue = await getConsoleQueue(testDb, minutes(0));
  expect(queue.map((i) => [i.kind, i.reportCount])).toEqual([["dispute", 2], ["confirm", 1]]);
});

test("delayed only past the expected time and with no result; oldest first within a kind", async () => {
  const { rows } = await fourTeamMatches();
  const [m1, m2] = rows as [(typeof rows)[number], (typeof rows)[number]];
  await testDb.update(matches).set({ status: "in_progress", openedAt: minutes(-30) }).where(eq(matches.id, m1.id));
  await testDb.update(matches).set({ status: "in_progress", openedAt: minutes(-100) }).where(eq(matches.id, m2.id));
  const queue = await getConsoleQueue(testDb, minutes(0));
  expect(queue.map((i) => [i.kind, i.matchId])).toEqual([["delayed", m2.id]]);

  await testDb.update(matches).set({ openedAt: minutes(-200) }).where(eq(matches.id, m1.id));
  expect((await getConsoleQueue(testDb, minutes(0))).map((i) => i.matchId)).toEqual([m1.id, m2.id]);
});

test("finished and non-live tournaments are excluded", async () => {
  const { s, rows } = await fourTeamMatches();
  await testDb.update(matches).set({ status: "disputed" }).where(eq(matches.id, rows[0]!.id));
  expect(await getConsoleQueue(testDb, minutes(0))).toHaveLength(2);
  await testDb.update(tournaments).set({ status: "finished" }).where(eq(tournaments.id, s.tournament.id));
  expect(await getConsoleQueue(testDb, minutes(0))).toEqual([]);
});
