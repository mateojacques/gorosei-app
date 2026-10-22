import { beforeEach, expect, test } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import {
  auditLog,
  brackets,
  entryCredits,
  entryPayments,
  matches,
  registrationPlayers,
  registrations,
  tournaments,
} from "../../../src/server/db/schema";
import { markPaid } from "../../../src/server/tournaments/confirmations";
import { closeCheckIn, openCheckIn } from "../../../src/server/matchday/check-in";
import { updateRoster } from "../../../src/server/tournaments/registrations";
import type { Rank } from "../../../src/shared/rank";
import { checkedInTestTeam, createTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

const CLOSE = new Date("2026-11-01T19:50:00Z");
const TIERS: Rank["tier"][] = ["CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND", "EMERALD", "PLATINUM", "GOLD", "SILVER"];
const rank = (i: number): Rank => ({ tier: TIERS[i]!, division: "I", lp: 0 });

beforeEach(resetTestDb);

type Spec = { checked: number; decision?: "play" | "withdraw" };

/** Builds a check_in tournament with one team per spec (team `t0` has the best rank). */
async function fieldOf(specs: Spec[], overrides: Parameters<typeof createTestTournament>[0] = {}) {
  const tournament = await createTestTournament({ status: "registration_open", entryFeeArs: 0, rankSource: "current", ...overrides });
  const teams = [];
  for (const [i, spec] of specs.entries()) {
    const team = await checkedInTestTeam(tournament, `t${i}p`, spec.checked, { rank: rank(i), decision: spec.decision });
    if (overrides.entryFeeArs) await markPaid(testDb, team.captain, tournament.id, team.ids, "test");
    teams.push(team);
  }
  await testDb.update(tournaments).set({ status: "check_in" }).where(eq(tournaments.id, tournament.id));
  return { tournament, teams };
}

const full = (n: number): Spec[] => Array.from({ length: n }, () => ({ checked: 5 }));
const statusOf = async (id: string) =>
  (await testDb.select({ s: tournaments.status }).from(tournaments).where(eq(tournaments.id, id)))[0]!.s;
const regStatus = async (id: string) =>
  (await testDb.select({ s: registrations.status }).from(registrations).where(eq(registrations.id, id)))[0]!.s;
const matchRows = (tournamentId: string) =>
  testDb.select().from(matches).where(eq(matches.tournamentId, tournamentId)).orderBy(asc(matches.bmMatchId));
const audits = (action: string) => testDb.select().from(auditLog).where(eq(auditLog.action, action));

test("openCheckIn waits for one hour before start, moves the state, and locks rosters", async () => {
  const tournament = await createTestTournament({ status: "registration_open", entryFeeArs: 0 });
  const team = await checkedInTestTeam(tournament, "a", 0);
  await testDb.update(tournaments).set({ status: "registration_closed" }).where(eq(tournaments.id, tournament.id));

  expect(await openCheckIn(testDb, tournament.id, new Date("2026-11-01T18:59:00Z"), null)).toEqual({ ok: false, reason: "too_early" });
  expect(await openCheckIn(testDb, tournament.id, new Date("2026-11-01T19:00:00Z"), null)).toEqual({ ok: true });
  expect(await statusOf(tournament.id)).toBe("check_in");
  expect(await openCheckIn(testDb, tournament.id, new Date("2026-11-01T19:01:00Z"), null)).toEqual({ ok: false, reason: "invalid_state" });

  const result = await updateRoster(
    { db: testDb, riot: new FakeRiotClient() },
    team.captain,
    team.registrationId,
    { starters: team.starters, subs: [team.sub] },
  );
  expect(result).toMatchObject({ ok: false, reason: "locked" });
});

test("openCheckIn with force skips the time check", async () => {
  const tournament = await createTestTournament({ status: "registration_closed" });
  expect(await openCheckIn(testDb, tournament.id, new Date("2026-10-01T00:00:00Z"), "x", { force: true })).toEqual({ ok: true });
});

test("8 full teams go live with 4 open matches and seed 1 against 8", async () => {
  const { tournament, teams } = await fieldOf(full(8));
  expect(await closeCheckIn(testDb, tournament.id, CLOSE, null)).toEqual({ ok: true, outcome: "live", forfeited: 0, teams: 8 });
  expect(await statusOf(tournament.id)).toBe("live");
  const rows = await matchRows(tournament.id);
  const round1 = rows.filter((m) => m.phase === "winners" && m.roundNo === 1);
  expect(round1.length).toBe(4);
  expect(round1.every((m) => m.status === "open" && m.openedAt)).toBe(true);
  expect(round1.map((m) => [m.reg1Id, m.reg2Id].sort().join())).toContain([teams[0]!.registrationId, teams[7]!.registrationId].sort().join());
  expect(rows.find((m) => m.phase === "grand_final")!.bestOf).toBe(3);
  expect(round1[0]!.bestOf).toBe(1);
  expect((await audits("tournament.live")).length).toBe(1);
});

test("5 teams get byes: one open match, the rest waiting", async () => {
  const { tournament } = await fieldOf(full(5));
  await closeCheckIn(testDb, tournament.id, CLOSE, null);
  const rows = await matchRows(tournament.id);
  expect(rows.filter((m) => m.phase === "winners" && m.roundNo === 1 && m.status === "open").length).toBe(1);
  expect(rows.filter((m) => m.status === "open").length).toBe(2); // the one first-round match + the round-2 match between two bye teams
  expect(rows.some((m) => m.status === "open" && (!m.reg1Id || !m.reg2Id))).toBe(false);
});

test("3 teams and 2 teams work without crashing", async () => {
  for (const n of [3, 2]) {
    const { tournament } = await fieldOf(full(n));
    expect(await closeCheckIn(testDb, tournament.id, CLOSE, null)).toMatchObject({ ok: true, outcome: "live", teams: n });
    expect((await matchRows(tournament.id)).some((m) => m.status === "open")).toBe(true);
    await resetTestDb();
  }
});

test("single elimination also starts", async () => {
  const { tournament } = await fieldOf(full(4), { bracket: "single_elimination" });
  expect(await closeCheckIn(testDb, tournament.id, CLOSE, null)).toMatchObject({ outcome: "live" });
  expect((await matchRows(tournament.id)).map((m) => m.phase).sort()).toEqual(["final", "main", "main", "third_place"]);
});

test("one or zero survivors cancel the tournament with credits and no bracket", async () => {
  const { tournament, teams } = await fieldOf([{ checked: 5 }, { checked: 1 }], { entryFeeArs: 5000 });
  expect(await closeCheckIn(testDb, tournament.id, CLOSE, null)).toEqual({ ok: true, outcome: "cancelled", forfeited: 1, teams: 2 });
  expect(await statusOf(tournament.id)).toBe("cancelled");
  expect(await testDb.select().from(brackets)).toEqual([]);
  const credited = (await testDb.select().from(entryCredits)).map((c) => c.userId).sort();
  expect(credited).toEqual([...teams[0]!.ids].sort());
  expect(await regStatus(teams[1]!.registrationId)).toBe("forfeited");

  await resetTestDb();
  const none = await fieldOf([{ checked: 0 }, { checked: 2 }]);
  expect(await closeCheckIn(testDb, none.tournament.id, CLOSE, null)).toMatchObject({ outcome: "cancelled", forfeited: 2 });
  expect(await testDb.select().from(brackets)).toEqual([]);
});

test("short-handed, withdrawn and forfeit outcomes", async () => {
  const { tournament, teams } = await fieldOf([
    { checked: 4 },
    { checked: 4, decision: "withdraw" },
    { checked: 3 },
    { checked: 2, decision: "play" },
    { checked: 0 },
    { checked: 5 },
  ]);
  expect(await closeCheckIn(testDb, tournament.id, CLOSE, null)).toMatchObject({ outcome: "live", forfeited: 3, teams: 6 });
  const statuses = await Promise.all(teams.map((t) => regStatus(t.registrationId)));
  expect(statuses).toEqual(["confirmed", "forfeited", "confirmed", "forfeited", "forfeited", "confirmed"]);
  const seeded = new Set((await matchRows(tournament.id)).flatMap((m) => [m.reg1Id, m.reg2Id]));
  for (const i of [1, 3, 4]) expect(seeded.has(teams[i]!.registrationId)).toBe(false);
  expect((await audits("registration.forfeited")).length).toBe(3);
  const players = await testDb
    .select({ active: registrationPlayers.active })
    .from(registrationPlayers)
    .where(eq(registrationPlayers.registrationId, teams[1]!.registrationId));
  expect(players.every((p) => !p.active)).toBe(true);
});

test("a forfeited team's payments are forfeited, not credited", async () => {
  const { tournament, teams } = await fieldOf([{ checked: 5 }, { checked: 5 }, { checked: 0 }], { entryFeeArs: 5000 });
  await closeCheckIn(testDb, tournament.id, CLOSE, null);
  const forfeited = await testDb
    .select()
    .from(entryPayments)
    .where(and(eq(entryPayments.tournamentId, tournament.id), eq(entryPayments.forfeited, true)));
  expect(forfeited.length).toBe(6);
});

test("closeCheckIn is idempotent and respects the deadline", async () => {
  const { tournament } = await fieldOf(full(4));
  expect(await closeCheckIn(testDb, tournament.id, new Date("2026-11-01T19:49:00Z"), null)).toEqual({ ok: false, reason: "too_early" });
  expect(await closeCheckIn(testDb, tournament.id, CLOSE, null)).toMatchObject({ ok: true });
  const before = await matchRows(tournament.id);
  expect(await closeCheckIn(testDb, tournament.id, CLOSE, null)).toEqual({ ok: false, reason: "invalid_state" });
  expect(await matchRows(tournament.id)).toEqual(before);
});
