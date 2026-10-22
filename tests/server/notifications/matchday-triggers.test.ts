import { beforeEach, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { matches, notifications, registrationPlayers, registrations, teams, tournaments, user } from "../../../src/server/db/schema";
import { openCheckIn } from "../../../src/server/matchday/check-in";
import { confirmMatch, forfeitMatch, resetMatch } from "../../../src/server/matchday/moderation";
import { reportResult } from "../../../src/server/matchday/reports";
import { checkInWindow } from "../../../src/shared/check-in";
import { confirmedTestTeam, createTestTournament, startedTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

let mod: string;

beforeEach(async () => {
  await resetTestDb();
  mod = await createTestUser("mod");
  await testDb.update(user).set({ role: "moderator" }).where(eq(user.id, mod));
});

const all = () => testDb.select().from(notifications).orderBy(asc(notifications.createdAt));
const kinds = async (kind: string) => (await all()).filter((n) => n.kind === kind);
const rows = (tournamentId: string) =>
  testDb.select().from(matches).where(eq(matches.tournamentId, tournamentId)).orderBy(asc(matches.roundNo), asc(matches.number));

async function teamNames(): Promise<Map<string, string>> {
  const regs = await testDb
    .select({ id: registrations.id, name: teams.name })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId));
  return new Map(regs.map((r) => [r.id, r.name]));
}

const proof = { screenshotUrl: null, riotMatchIds: [] as string[] };

test("opening check-in tells every confirmed roster, and only once", async () => {
  const tournament = await createTestTournament({ status: "registration_open", entryFeeArs: 0 });
  await confirmedTestTeam(tournament.id, "a");
  await confirmedTestTeam(tournament.id, "b");
  await testDb.update(tournaments).set({ status: "registration_closed" }).where(eq(tournaments.id, tournament.id));
  expect(await openCheckIn(testDb, tournament.id, new Date(), null, { force: true })).toEqual({ ok: true });
  const open = await kinds("check_in_open");
  expect(open).toHaveLength(12);
  expect(open[0]!.payload).toMatchObject({
    kind: "check_in_open",
    closesAt: checkInWindow(tournament.startsAt).closesAt.toISOString(),
    tournament: { slug: tournament.slug, edition: tournament.edition },
  });
  expect(await openCheckIn(testDb, tournament.id, new Date(), null, { force: true })).toEqual({ ok: false, reason: "invalid_state" });
  expect(await kinds("check_in_open")).toHaveLength(12);
});

test("first-round matches tell both rosters who they play", async () => {
  const { tournament } = await startedTestTournament(4);
  const names = await teamNames();
  const ready = await kinds("match_ready");
  expect(ready).toHaveLength(24);
  const open = (await rows(tournament.id)).filter((m) => m.status === "open");
  for (const note of ready) {
    const payload = note.payload;
    if (payload.kind !== "match_ready") throw new Error("kind");
    const match = open.find((m) => m.id === payload.matchId)!;
    const [player] = await testDb.select().from(registrationPlayers).where(eq(registrationPlayers.userId, note.userId));
    const other = player!.registrationId === match.reg1Id ? match.reg2Id! : match.reg1Id!;
    expect(payload.opponent).toBe(names.get(other)!);
    expect(note.dedupeKey).toBe(`match_ready:${match.id}:${match.openedAt!.toISOString()}:${note.userId}`);
  }
});

test("a bye match notifies nobody", async () => {
  const { tournament } = await startedTestTournament(3);
  const ready = await kinds("match_ready");
  const withTwoTeams = (await rows(tournament.id)).filter((m) => m.status === "open" && m.reg1Id && m.reg2Id);
  expect(ready).toHaveLength(withTwoTeams.length * 12);
  expect(new Set(ready.map((n) => (n.payload as { matchId: string }).matchId))).toEqual(new Set(withTwoTeams.map((m) => m.id)));
});

test("a confirmed result tells both rosters from their side, and the final opens only with both finalists", async () => {
  const { tournament, teams: field } = await startedTestTournament(4, { bracket: "single_elimination", bestOf: 3 });
  const semis = (await rows(tournament.id)).filter((m) => m.phase === "main");
  const final = () => rows(tournament.id).then((r) => r.find((m) => m.phase === "final")!);
  const readyFor = async (matchId: string) =>
    (await kinds("match_ready")).filter((n) => (n.payload as { matchId: string }).matchId === matchId);

  await confirmMatch(testDb, mod, semis[0]!.id, { score1: 2, score2: 1 });
  const results = (await kinds("result_confirmed")).filter((n) => (n.payload as { matchId: string }).matchId === semis[0]!.id);
  expect(results).toHaveLength(12);
  const winners = field.find((t) => t.registrationId === semis[0]!.reg1Id)!;
  for (const note of results) {
    const won = winners.ids.includes(note.userId);
    expect(note.payload).toMatchObject({ kind: "result_confirmed", won, score: won ? [2, 1] : [1, 2] });
  }
  expect(await readyFor((await final()).id)).toHaveLength(0);

  await confirmMatch(testDb, mod, semis[1]!.id, { score1: 0, score2: 2 });
  expect(await readyFor((await final()).id)).toHaveLength(12);
});

test("a forfeit is a confirmed result for both rosters", async () => {
  const { tournament } = await startedTestTournament(4, { bracket: "single_elimination" });
  const [match] = (await rows(tournament.id)).filter((m) => m.status === "open");
  expect(await forfeitMatch(testDb, mod, match!.id, match!.reg2Id!)).toMatchObject({ ok: true });
  const results = await kinds("result_confirmed");
  expect(results.find((n) => n.payload.kind === "result_confirmed" && n.payload.won)!.payload).toMatchObject({ score: [1, 0] });
  expect(results).toHaveLength(12);
  expect(results.filter((n) => (n.payload as { won: boolean }).won)).toHaveLength(6);
});

test("a reset match is ready again", async () => {
  const { tournament } = await startedTestTournament(2);
  const [match] = (await rows(tournament.id)).filter((m) => m.status === "open");
  const readyFor = async () => (await kinds("match_ready")).filter((n) => (n.payload as { matchId: string }).matchId === match!.id);
  expect(await readyFor()).toHaveLength(12);
  await Bun.sleep(5);
  expect(await resetMatch(testDb, mod, match!.id)).toEqual({ ok: true });
  expect(await readyFor()).toHaveLength(24);
});

test("conflicting reports tell both captains once", async () => {
  const { tournament, teams: field } = await startedTestTournament(2, { bestOf: 3 });
  const [match] = (await rows(tournament.id)).filter((m) => m.status === "open");
  const captainOf = (registrationId: string) => field.find((t) => t.registrationId === registrationId)!.captain;
  const a = captainOf(match!.reg1Id!);
  const b = captainOf(match!.reg2Id!);
  await reportResult(testDb, a, match!.id, { own: 2, opponent: 0, ...proof });
  expect(await kinds("match_disputed")).toHaveLength(0);
  expect(await reportResult(testDb, b, match!.id, { own: 2, opponent: 1, ...proof })).toEqual({ ok: true, status: "disputed" });
  const disputed = await kinds("match_disputed");
  expect(disputed.map((n) => n.userId).sort()).toEqual([a, b].sort());
  expect(disputed[0]!.payload).toMatchObject({ kind: "match_disputed", matchId: match!.id });
  await reportResult(testDb, b, match!.id, { own: 2, opponent: 0, ...proof });
  expect(await kinds("match_disputed")).toHaveLength(2);
});
