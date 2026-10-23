import { beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { auditLog, matchMessages, matches, tournaments, user } from "../../../src/server/db/schema";
import { getConsoleQueue, getMatchView } from "../../../src/server/bracket/bracket";
import { issueTournamentCodes, riotCallbackUrl } from "../../../src/server/matchday/tournament-codes";
import { confirmMatch, resetMatch } from "../../../src/server/matchday/moderation";
import { postLobby } from "../../../src/server/matchday/reports";
import { startedTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotTournamentClient } from "../../helpers/fake-riot-tournament";

const NOW = new Date("2026-11-01T20:00:00Z");
const CALLBACK = "https://gorosei.gg/api/riot/callback/off";
let client: FakeRiotTournamentClient;
let mod: string;

beforeEach(async () => {
  await resetTestDb();
  client = new FakeRiotTournamentClient();
  mod = await createTestUser("mod");
  await testDb.update(user).set({ role: "moderator" }).where(eq(user.id, mod));
});

const run = () => issueTournamentCodes({ db: testDb, client, callbackUrl: CALLBACK }, NOW);
const openMatches = (tournamentId: string) =>
  testDb.select().from(matches).where(and(eq(matches.tournamentId, tournamentId), eq(matches.status, "open")));
const byId = async (id: string) => (await testDb.select().from(matches).where(eq(matches.id, id)))[0]!;

test("the callback URL carries the secret, or a dead path without one", () => {
  expect(riotCallbackUrl("https://gorosei.gg", "s".repeat(32))).toBe(`https://gorosei.gg/api/riot/callback/${"s".repeat(32)}`);
  expect(riotCallbackUrl("https://gorosei.gg", undefined)).toBe(CALLBACK);
});

test("each open match gets a code, starts and announces it in its chat", async () => {
  const { tournament } = await startedTestTournament(4, { draftMode: "blind_pick" });
  const open = await openMatches(tournament.id);
  expect(open).toHaveLength(2);
  expect(await run()).toEqual({ issued: 2, failed: 0 });
  for (const m of open) {
    const row = await byId(m.id);
    expect(row.status).toBe("in_progress");
    expect(row.tournamentCode).toMatch(/^LA2-CODE-\d$/);
    const chat = await testDb.select().from(matchMessages).where(eq(matchMessages.matchId, m.id));
    expect(chat).toEqual([expect.objectContaining({ kind: "lobby", body: row.tournamentCode, authorUserId: null })]);
  }
  const codeCalls = client.calls.filter((c) => c.method === "createCodes");
  expect(codeCalls.map((c) => c.method === "createCodes" && c.metadata).sort()).toEqual(open.map((m) => m.id).sort());
  expect(codeCalls.every((c) => c.method === "createCodes" && c.pickType === "BLIND_PICK" && c.count === 1)).toBe(true);
  expect((await testDb.select().from(auditLog).where(eq(auditLog.action, "match.code_issued"))).every((a) => a.actorUserId === null)).toBe(true);
});

test("the provider and the Riot tournament are created once", async () => {
  const { tournament } = await startedTestTournament(4);
  await run();
  const [semi] = await testDb.select().from(matches).where(and(eq(matches.tournamentId, tournament.id), eq(matches.status, "in_progress")));
  await confirmMatch(testDb, mod, semi!.id, { score1: 1, score2: 0 });
  await run();
  expect(client.calls.filter((c) => c.method === "registerProvider")).toEqual([{ method: "registerProvider", url: CALLBACK }]);
  expect(client.calls.filter((c) => c.method === "createTournament")).toEqual([
    { method: "createTournament", providerId: 1, name: `${tournament.title} #${tournament.edition}` },
  ]);
  const [stored] = await testDb.select().from(tournaments).where(eq(tournaments.id, tournament.id));
  expect(stored!.riotTournamentId).toBe(101);
});

test("the code is private like the lobby", async () => {
  const { tournament, teams } = await startedTestTournament(2);
  await run();
  const [match] = await testDb.select().from(matches).where(eq(matches.tournamentId, tournament.id));
  const code = (await byId(match!.id)).tournamentCode;
  const view = (viewer: { userId: string; role: "player" | "moderator" } | null) => getMatchView(testDb, match!.id, viewer, NOW);
  expect((await view({ userId: teams[0]!.captain, role: "player" }))!.tournamentCode).toBe(code);
  expect((await view({ userId: mod, role: "moderator" }))!.tournamentCode).toBe(code);
  await createTestUser("outsider");
  expect((await view({ userId: "outsider", role: "player" }))!.tournamentCode).toBeNull();
  expect((await view(null))!.tournamentCode).toBeNull();
});

test("when Riot fails the matches stay open for a moderator lobby, and the next run issues them", async () => {
  const { tournament } = await startedTestTournament(4);
  client.failing = true;
  expect(await run()).toEqual({ issued: 0, failed: 2 });
  expect(await openMatches(tournament.id)).toHaveLength(2);
  expect((await getConsoleQueue(testDb, NOW)).filter((i) => i.kind === "lobby")).toHaveLength(2);
  client.failing = false;
  expect(await run()).toEqual({ issued: 2, failed: 0 });
});

test("a lobby posted while the code was being requested wins", async () => {
  const { tournament } = await startedTestTournament(2);
  const [match] = await openMatches(tournament.id);
  client.beforeCode = async () => {
    await postLobby(testDb, mod, match!.id, { name: "sala-1", password: "pw" });
  };
  expect(await run()).toEqual({ issued: 0, failed: 0 });
  expect(await byId(match!.id)).toMatchObject({ lobbyName: "sala-1", tournamentCode: null, status: "in_progress" });
});

test("a reset match loses its code and gets a new one", async () => {
  const { tournament } = await startedTestTournament(2);
  await run();
  const [match] = await testDb.select().from(matches).where(eq(matches.tournamentId, tournament.id));
  const first = (await byId(match!.id)).tournamentCode;
  expect(await resetMatch(testDb, mod, match!.id)).toEqual({ ok: true });
  expect((await byId(match!.id)).tournamentCode).toBeNull();
  await run();
  const second = (await byId(match!.id)).tournamentCode;
  expect(second).not.toBeNull();
  expect(second).not.toBe(first);
});

test("a match still waiting for a team gets none", async () => {
  const { tournament } = await startedTestTournament(4, { bracket: "single_elimination" });
  await run();
  const [final] = await testDb.select().from(matches).where(and(eq(matches.tournamentId, tournament.id), eq(matches.phase, "final")));
  expect(final!.tournamentCode).toBeNull();
  expect(client.calls.filter((c) => c.method === "createCodes")).toHaveLength(2);
});
