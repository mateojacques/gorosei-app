import { beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import {
  auditLog,
  brackets,
  checkIns,
  matchReports,
  matches,
  registrationPlayers,
  teamMembers,
  tournaments,
  user,
} from "../../../src/server/db/schema";
import { confirmMatch, forfeitMatch, resetMatch, swapPlayer } from "../../../src/server/matchday/moderation";
import { postLobby, reportResult } from "../../../src/server/matchday/reports";
import { linkedPlayer, startedTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

beforeEach(resetTestDb);

let mod: string;
async function moderator() {
  mod = await createTestUser("mod");
  await testDb.update(user).set({ role: "moderator" }).where(eq(user.id, mod));
}

type Started = Awaited<ReturnType<typeof startedTestTournament>>;
const rows = (tournamentId: string) => testDb.select().from(matches).where(eq(matches.tournamentId, tournamentId));
const statusOf = async (id: string) => (await testDb.select({ s: tournaments.status }).from(tournaments).where(eq(tournaments.id, id)))[0]!.s;
const audits = (action: string) => testDb.select().from(auditLog).where(eq(auditLog.action, action));
const scoreFor = (bestOf: number, side: 1 | 2) => {
  const n = Math.ceil(bestOf / 2);
  return side === 1 ? { score1: n, score2: 0 } : { score1: 0, score2: n };
};

/** Plays every playable match; the better-seeded team (lower index) wins, except where `skip` says to stop. */
async function playOut(started: Started, skip: (phase: string) => boolean = () => false) {
  const seed = new Map(started.teams.map((t, i) => [t.registrationId, i]));
  for (let guard = 0; guard < 40; guard++) {
    const next = (await rows(started.tournament.id)).find(
      (m) => m.status === "open" && m.reg1Id && m.reg2Id && !skip(m.phase),
    );
    if (!next) return;
    const side = seed.get(next.reg1Id!)! < seed.get(next.reg2Id!)! ? 1 : 2;
    const result = await confirmMatch(testDb, mod, next.id, scoreFor(next.bestOf, side));
    expect(result.ok).toBe(true);
  }
}

const openMatch = async (tournamentId: string) => (await rows(tournamentId)).find((m) => m.status === "open")!;
const captainOf = (started: Started, regId: string) => started.teams.find((t) => t.registrationId === regId)!.captain;
const proof = { screenshotUrl: null, riotMatchIds: [] as string[] };

test("confirmMatch uses agreeing reports, a single report, or refuses with none", async () => {
  await moderator();
  const s = await startedTestTournament(2, { bracket: "single_elimination", finalsBestOf: 1 });
  const m = await openMatch(s.tournament.id);
  expect(await confirmMatch(testDb, mod, m.id)).toEqual({ ok: false, reason: "no_result" });
  await reportResult(testDb, captainOf(s, m.reg1Id!), m.id, { own: 1, opponent: 0, ...proof });
  expect(await confirmMatch(testDb, mod, m.id)).toEqual({ ok: true, finished: true });
  const [row] = await testDb.select().from(matches).where(eq(matches.id, m.id));
  expect(row).toMatchObject({ status: "completed", score1: 1, score2: 0, winnerRegId: m.reg1Id, confirmedBy: mod });
});

test("agreeing reports confirm; a dispute needs an override that resolves it", async () => {
  await moderator();
  const s = await startedTestTournament(2, { bracket: "single_elimination", finalsBestOf: 1 });
  const m = await openMatch(s.tournament.id);
  await reportResult(testDb, captainOf(s, m.reg1Id!), m.id, { own: 1, opponent: 0, ...proof });
  await reportResult(testDb, captainOf(s, m.reg2Id!), m.id, { own: 1, opponent: 0, ...proof }); // disputed
  expect((await testDb.select().from(matches).where(eq(matches.id, m.id)))[0]!.status).toBe("disputed");
  expect(await confirmMatch(testDb, mod, m.id)).toEqual({ ok: false, reason: "no_result" });
  expect(await confirmMatch(testDb, mod, m.id, { score1: 1, score2: 1 })).toEqual({ ok: false, reason: "invalid_score" });
  expect(await confirmMatch(testDb, mod, m.id, { score1: 0, score2: 1 })).toEqual({ ok: true, finished: true });
  expect((await testDb.select().from(matches).where(eq(matches.id, m.id)))[0]!.winnerRegId).toBe(m.reg2Id);
  expect((await audits("match.confirmed")).length).toBe(1);
});

test("the winner appears in the next match, which opens when both teams are known", async () => {
  await moderator();
  const s = await startedTestTournament(4, { bracket: "single_elimination" });
  const semis = (await rows(s.tournament.id)).filter((m) => m.phase === "main");
  await confirmMatch(testDb, mod, semis[0]!.id, scoreFor(1, 1));
  let final = (await rows(s.tournament.id)).find((m) => m.phase === "final")!;
  expect([final.reg1Id, final.reg2Id].filter(Boolean)).toEqual([semis[0]!.reg1Id!]);
  expect(final.status).toBe("waiting");
  await confirmMatch(testDb, mod, semis[1]!.id, scoreFor(1, 2));
  final = (await rows(s.tournament.id)).find((m) => m.phase === "final")!;
  expect(final.status).toBe("open");
  expect(final.openedAt).not.toBeNull();
  expect(new Set([final.reg1Id, final.reg2Id])).toEqual(new Set([semis[0]!.reg1Id, semis[1]!.reg2Id]));
});

test("confirming twice, even concurrently, succeeds once", async () => {
  await moderator();
  const s = await startedTestTournament(4, { bracket: "single_elimination" });
  const m = await openMatch(s.tournament.id);
  const results = await Promise.all([
    confirmMatch(testDb, mod, m.id, scoreFor(1, 1)),
    confirmMatch(testDb, mod, m.id, scoreFor(1, 2)),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "already_completed" });
});

test("grand final won from the winners side finishes the tournament with no reset", async () => {
  await moderator();
  const s = await startedTestTournament(4);
  await playOut(s, (phase) => phase === "grand_final" || phase === "reset");
  const gf = (await rows(s.tournament.id)).find((m) => m.phase === "grand_final")!;
  expect(gf.status).toBe("open");
  expect(gf.reg1Id).toBe(s.teams[0]!.registrationId);
  expect(await confirmMatch(testDb, mod, gf.id, scoreFor(gf.bestOf, 1))).toEqual({ ok: true, finished: true });
  expect((await rows(s.tournament.id)).some((m) => m.phase === "reset")).toBe(false);
  expect(await statusOf(s.tournament.id)).toBe("finished");
  const [bracket] = await testDb.select().from(brackets);
  expect(bracket!.finalStandings?.[0]).toMatchObject({ registrationId: s.teams[0]!.registrationId, rank: 1 });
  expect((await audits("tournament.finished")).length).toBe(1);
});

test("grand final won from the losers side opens the reset, which finishes the tournament", async () => {
  await moderator();
  const s = await startedTestTournament(4);
  await playOut(s, (phase) => phase === "grand_final" || phase === "reset");
  const gf = (await rows(s.tournament.id)).find((m) => m.phase === "grand_final")!;
  expect(await confirmMatch(testDb, mod, gf.id, scoreFor(gf.bestOf, 2))).toEqual({ ok: true, finished: false });
  const reset = (await rows(s.tournament.id)).find((m) => m.phase === "reset")!;
  expect(reset.status).toBe("open");
  expect(await statusOf(s.tournament.id)).toBe("live");
  expect(await confirmMatch(testDb, mod, reset.id, scoreFor(reset.bestOf, 1))).toEqual({ ok: true, finished: true });
  expect(await statusOf(s.tournament.id)).toBe("finished");
});

test("forfeitMatch gives the opponent a walkover and is audited", async () => {
  await moderator();
  const s = await startedTestTournament(4, { bracket: "single_elimination" });
  const semis = (await rows(s.tournament.id)).filter((m) => m.phase === "main");
  expect(await forfeitMatch(testDb, mod, semis[0]!.id, semis[0]!.reg1Id!)).toEqual({ ok: true, finished: false });
  const final = (await rows(s.tournament.id)).find((m) => m.phase === "final")!;
  expect([final.reg1Id, final.reg2Id]).toContain(semis[0]!.reg2Id);
  expect((await audits("match.forfeited")).length).toBe(1);
  expect(await forfeitMatch(testDb, mod, semis[0]!.id, semis[0]!.reg1Id!)).toEqual({ ok: false, reason: "already_completed" });
  expect(await forfeitMatch(testDb, mod, semis[1]!.id, s.teams[0]!.registrationId === semis[1]!.reg1Id ? "x".padEnd(36, "0") : s.teams[0]!.registrationId)).toMatchObject({ ok: false });
});

test("resetMatch reopens a completed match and clears reports; refuses once the next match was played", async () => {
  await moderator();
  const s = await startedTestTournament(4, { bracket: "single_elimination" });
  const semis = (await rows(s.tournament.id)).filter((m) => m.phase === "main");
  await reportResult(testDb, captainOf(s, semis[0]!.reg1Id!), semis[0]!.id, { own: 1, opponent: 0, ...proof });
  await postLobby(testDb, mod, semis[0]!.id, { name: "l", password: "p" }).catch(() => null);
  await confirmMatch(testDb, mod, semis[0]!.id);
  expect(await resetMatch(testDb, mod, semis[0]!.id)).toEqual({ ok: true });
  const [again] = await testDb.select().from(matches).where(eq(matches.id, semis[0]!.id));
  expect(again).toMatchObject({ status: "open", score1: null, winnerRegId: null, confirmedBy: null, lobbyName: null });
  expect(await testDb.select().from(matchReports).where(eq(matchReports.matchId, semis[0]!.id))).toEqual([]);
  const audit = (await audits("match.reset"))[0]!;
  expect((audit.data as { reports: unknown[] }).reports).toHaveLength(1);
  expect(audit.actorUserId).toBe(mod);

  await confirmMatch(testDb, mod, semis[0]!.id, scoreFor(1, 1));
  await confirmMatch(testDb, mod, semis[1]!.id, scoreFor(1, 1));
  const final = (await rows(s.tournament.id)).find((m) => m.phase === "final")!;
  await confirmMatch(testDb, mod, final.id, scoreFor(final.bestOf, 1));
  const before = await rows(s.tournament.id);
  expect(await resetMatch(testDb, mod, semis[0]!.id)).toEqual({ ok: false, reason: "next_match_started" });
  expect(await rows(s.tournament.id)).toEqual(before);
});

test("resetting a waiting match is refused", async () => {
  await moderator();
  const s = await startedTestTournament(4, { bracket: "single_elimination" });
  const waiting = (await rows(s.tournament.id)).find((m) => m.status === "waiting")!;
  expect(await resetMatch(testDb, mod, waiting.id)).toEqual({ ok: false, reason: "invalid_state" });
});

test("every moderator action writes an audit row with the moderator as actor", async () => {
  await moderator();
  const s = await startedTestTournament(4, { bracket: "single_elimination" });
  const semis = (await rows(s.tournament.id)).filter((m) => m.phase === "main");
  await confirmMatch(testDb, mod, semis[0]!.id, scoreFor(1, 1));
  await forfeitMatch(testDb, mod, semis[1]!.id, semis[1]!.reg2Id!);
  await resetMatch(testDb, mod, semis[0]!.id);
  for (const action of ["match.confirmed", "match.forfeited", "match.reset"]) {
    const [row] = await audits(action);
    expect(row!.actorUserId).toBe(mod);
  }
});

// ---- swapPlayer ----

async function swapSetup() {
  await moderator();
  const s = await startedTestTournament(2, { bracket: "single_elimination", finalsBestOf: 1 });
  const deps = { db: testDb, riot: new FakeRiotClient() };
  return { s, deps, team: s.teams[0]! };
}

test("swapPlayer replaces a starter with a team member and checks them in", async () => {
  const { s, deps, team } = await swapSetup();
  const extra = await linkedPlayer("extra");
  await testDb.insert(teamMembers).values({ teamId: team.teamId, userId: extra, role: "member" });
  expect(await swapPlayer(deps, mod, team.registrationId, team.starters[3]!, extra)).toEqual({ ok: true });
  const roster = await testDb.select().from(registrationPlayers).where(and(eq(registrationPlayers.registrationId, team.registrationId), eq(registrationPlayers.active, true)));
  expect(roster.map((p) => p.userId)).toContain(extra);
  expect(roster.map((p) => p.userId)).not.toContain(team.starters[3]!);
  expect(roster.find((p) => p.userId === extra)!.isSub).toBe(false);
  const [ci] = await testDb.select().from(checkIns).where(and(eq(checkIns.registrationId, team.registrationId), eq(checkIns.userId, extra)));
  expect(ci!.byUserId).toBe(mod);
  expect((await audits("registration.player_swapped"))[0]!.actorUserId).toBe(mod);
  void s;
});

test("swapPlayer promotes a sub already on the roster", async () => {
  const { deps, team } = await swapSetup();
  expect(await swapPlayer(deps, mod, team.registrationId, team.starters[0]!, team.sub)).toEqual({ ok: true });
  const roster = await testDb.select().from(registrationPlayers).where(and(eq(registrationPlayers.registrationId, team.registrationId), eq(registrationPlayers.active, true)));
  expect(roster).toHaveLength(5);
  expect(roster.find((p) => p.userId === team.sub)!.isSub).toBe(false);
});

test("swapPlayer refuses non-members and players on another roster", async () => {
  const { s, deps, team } = await swapSetup();
  const stranger = await linkedPlayer("stranger");
  expect(await swapPlayer(deps, mod, team.registrationId, team.starters[3]!, stranger)).toEqual({ ok: false, reason: "not_member" });
  const other = s.teams[1]!;
  await testDb.insert(teamMembers).values({ teamId: team.teamId, userId: other.starters[2]!, role: "member" });
  expect(await swapPlayer(deps, mod, team.registrationId, team.starters[3]!, other.starters[2]!)).toEqual({
    ok: false,
    reason: "player_already_registered",
  });
});

test("swapPlayer refuses a swap that breaks the tournament rules and leaves the roster intact", async () => {
  await moderator();
  const s = await startedTestTournament(2, {
    bracket: "single_elimination",
    eligibilityRules: [{ id: "r1", type: "player_rank_range", min: { tier: "DIAMOND", division: "IV" } }],
  }).catch(() => null);
  if (!s) throw new Error("setup failed");
  const team = s.teams[0]!;
  const bronze = await linkedPlayer("bronze", { tier: "BRONZE", division: "IV", lp: 0 });
  await testDb.insert(teamMembers).values({ teamId: team.teamId, userId: bronze, role: "member" });
  const result = await swapPlayer({ db: testDb, riot: new FakeRiotClient() }, mod, team.registrationId, team.starters[3]!, bronze);
  expect(result).toMatchObject({ ok: false, reason: "ineligible" });
  expect((result as { failures?: unknown[] }).failures?.length).toBeGreaterThan(0);
  const roster = await testDb.select().from(registrationPlayers).where(and(eq(registrationPlayers.registrationId, team.registrationId), eq(registrationPlayers.active, true)));
  expect(roster.map((p) => p.userId)).toContain(team.starters[3]!);
  expect(roster.map((p) => p.userId)).not.toContain(bronze);
});
