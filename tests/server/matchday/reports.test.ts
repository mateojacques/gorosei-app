import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, matchMessages, matchReports, matches } from "../../../src/server/db/schema";
import { getMatchView } from "../../../src/server/bracket/bracket";
import { postLobby, reportResult } from "../../../src/server/matchday/reports";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { startedTestTournament } from "../../helpers/competition";
import { user } from "../../../src/server/db/schema";

const NOW = new Date("2026-11-01T19:55:00Z");

beforeEach(resetTestDb);

async function setup(overrides: Parameters<typeof startedTestTournament>[1] = {}) {
  const { tournament, teams } = await startedTestTournament(2, overrides);
  const [match] = await testDb.select().from(matches).where(eq(matches.status, "open"));
  const mod = await createTestUser("mod");
  await testDb.update(user).set({ role: "moderator" }).where(eq(user.id, mod));
  const [a, b] = match!.reg1Id === teams[0]!.registrationId ? [teams[0]!, teams[1]!] : [teams[1]!, teams[0]!];
  return { tournament, match: match!, a, b, mod }; // a is reg1, b is reg2
}

const proof = { screenshotUrl: "https://i.imgur.com/x.png", riotMatchIds: [] as string[] };
const report = (own: number, opponent: number) => ({ own, opponent, ...proof });

test("postLobby stores the lobby, starts the match and adds a chat line; a second post is refused", async () => {
  const { match, mod } = await setup();
  expect(await postLobby(testDb, mod, match.id, { name: "gorosei-1", password: "abc123" })).toEqual({ ok: true });
  const [row] = await testDb.select().from(matches).where(eq(matches.id, match.id));
  expect(row).toMatchObject({ status: "in_progress", lobbyName: "gorosei-1", lobbyPassword: "abc123", lobbyPostedBy: mod });
  const chat = await testDb.select().from(matchMessages).where(eq(matchMessages.matchId, match.id));
  expect(chat).toHaveLength(1);
  expect(chat[0]).toMatchObject({ kind: "lobby", body: "gorosei-1" });
  expect(await postLobby(testDb, mod, match.id, { name: "x", password: "y" })).toEqual({ ok: false, reason: "lobby_exists" });
  expect((await testDb.select().from(auditLog).where(eq(auditLog.action, "match.lobby_posted"))).length).toBe(1);
});

test("postLobby on a waiting match is not_open", async () => {
  const { tournament } = await startedTestTournament(4, { bracket: "single_elimination" });
  const mod = await createTestUser("mod");
  const waiting = (await testDb.select().from(matches).where(eq(matches.tournamentId, tournament.id))).filter((m) => m.status === "waiting");
  expect(await postLobby(testDb, mod, waiting[0]!.id, { name: "x", password: "y" })).toEqual({ ok: false, reason: "not_open" });
});

test("captain reports: one report stays in progress, equal reports agree, different ones dispute and re-evaluate", async () => {
  const { match, a, b } = await setup();
  expect(await reportResult(testDb, a.captain, match.id, report(1, 0))).toEqual({ ok: true, status: "in_progress" });
  expect(await reportResult(testDb, b.captain, match.id, report(0, 1))).toEqual({ ok: true, status: "reported" });
  // team b now claims it won
  expect(await reportResult(testDb, b.captain, match.id, report(1, 0))).toEqual({ ok: true, status: "disputed" });
  // team b corrects it back
  expect(await reportResult(testDb, b.captain, match.id, report(0, 1))).toEqual({ ok: true, status: "reported" });
  const rows = await testDb.select().from(matchReports).where(eq(matchReports.matchId, match.id));
  expect(rows).toHaveLength(2);
  const reg2 = rows.find((r) => r.registrationId === b.registrationId)!;
  expect([reg2.score1, reg2.score2]).toEqual([1, 0]);
  const [row] = await testDb.select().from(matches).where(eq(matches.id, match.id));
  expect(row!.status).toBe("reported");
});

test("a report after confirmation is refused", async () => {
  const { match, a } = await setup();
  await testDb.update(matches).set({ status: "completed" }).where(eq(matches.id, match.id));
  expect(await reportResult(testDb, a.captain, match.id, report(1, 0))).toEqual({ ok: false, reason: "already_confirmed" });
});

test("impossible scores and outsiders are refused", async () => {
  const { match, a, b } = await setup({ bestOf: 3 });
  expect(await reportResult(testDb, a.captain, match.id, report(3, 3))).toEqual({ ok: false, reason: "invalid_score" });
  expect(await reportResult(testDb, a.captain, match.id, report(1, 1))).toEqual({ ok: false, reason: "invalid_score" });
  expect(await reportResult(testDb, a.ids[2]!, match.id, report(2, 0))).toEqual({ ok: false, reason: "not_captain" });
  const outsider = await createTestUser("outsider");
  expect(await reportResult(testDb, outsider, match.id, report(2, 0))).toEqual({ ok: false, reason: "not_participant" });
  expect(await reportResult(testDb, b.captain, crypto.randomUUID(), report(2, 0))).toEqual({ ok: false, reason: "not_found" });
});

test("a Bo1 refuses 2-0", async () => {
  const { match, a } = await setup();
  expect(await reportResult(testDb, a.captain, match.id, report(2, 0))).toEqual({ ok: false, reason: "invalid_score" });
});

test("a captain of another live team is not a participant", async () => {
  const { tournament, teams } = await startedTestTournament(4, { bracket: "single_elimination" });
  const [m] = await testDb.select().from(matches).where(eq(matches.tournamentId, tournament.id)).then((r) => r.filter((x) => x.status === "open"));
  const involved = new Set([m!.reg1Id, m!.reg2Id]);
  const other = teams.find((t) => !involved.has(t.registrationId))!;
  expect(await reportResult(testDb, other.captain, m!.id, report(1, 0))).toEqual({ ok: false, reason: "not_participant" });
});

test("finals use finalsBestOf", async () => {
  const { a } = await setup({ finalsBestOf: 3, bestOf: 1, bracket: "single_elimination" });
  // two teams in SE: the only first match is the final
  const [final] = await testDb.select().from(matches).where(eq(matches.phase, "final"));
  expect(final!.bestOf).toBe(3);
  expect(await reportResult(testDb, a.captain, final!.id, report(2, 1))).toMatchObject({ ok: true });
});

test("getMatchView hides lobby and reports from outsiders and delays are flagged", async () => {
  const { match, a, mod } = await setup();
  await postLobby(testDb, mod, match.id, { name: "lobby-x", password: "pw" });
  await reportResult(testDb, a.captain, match.id, report(1, 0));
  const outsider = await createTestUser("outsider");

  const asOutsider = await getMatchView(testDb, match.id, { userId: outsider, role: "player" }, NOW);
  expect(asOutsider!.lobby).toBeNull();
  expect(asOutsider!.reports).toEqual([]);
  expect((await getMatchView(testDb, match.id, null, NOW))!.lobby).toBeNull();

  for (const viewer of [
    { userId: a.captain, role: "player" as const },
    { userId: a.ids[3]!, role: "player" as const },
    { userId: mod, role: "moderator" as const },
    { userId: outsider, role: "admin" as const },
  ]) {
    const view = await getMatchView(testDb, match.id, viewer, NOW);
    expect(view!.lobby).toEqual({ name: "lobby-x", password: "pw" });
    expect(view!.reports).toHaveLength(1);
  }

  const view = await getMatchView(testDb, match.id, null, NOW);
  expect(view!.delayed).toBe(false);
  const late = await getMatchView(testDb, match.id, null, new Date(match.openedAt!.getTime() + 61 * 60_000));
  expect(late!.delayed).toBe(true);
  expect(view!.teams[0]).toMatchObject({ registrationId: match.reg1Id });
});
