import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  auditLog,
  rankSnapshots,
  registrationPlayers,
  registrations,
  riotAccounts,
  teamMembers,
  tournaments,
} from "../../../src/server/db/schema";
import { leaveTeam, removeMember } from "../../../src/server/teams/teams";
import {
  getRegistrationForTeam,
  getRegistrationView,
  listRegistrations,
  registerTeam,
  takePlayerSnapshot,
  updateRoster,
  withdrawRegistration,
} from "../../../src/server/tournaments/registrations";
import type { Rank } from "../../../src/shared/rank";
import { createTestRegistration, createTestTeam, createTestTournament, linkedPlayer } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

const PLAT2: Rank = { tier: "PLATINUM", division: "II", lp: 40 };
const DIA1: Rank = { tier: "DIAMOND", division: "I", lp: 10 };

let riot: FakeRiotClient;
const deps = () => ({ db: testDb, riot });

beforeEach(async () => {
  await resetTestDb();
  riot = new FakeRiotClient();
});

/** Creates `count` linked players named `${prefix}1..n`; the first one captains a team with the rest. */
async function squad(prefix: string, count = 5, rank: Rank | null = PLAT2) {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) ids.push(await linkedPlayer(`${prefix}${i}`, rank));
  const team = await createTestTeam(ids[0]!, ids.slice(1));
  return { ids, team, captain: ids[0]! };
}

const openTournament = (overrides: Parameters<typeof createTestTournament>[0] = {}) =>
  createTestTournament({ status: "registration_open", ...overrides });

test("registering stores a snapshot per player", async () => {
  const tournament = await openTournament({ rankSource: "peak_season" });
  await linkedPlayer("plat", PLAT2, { level: 187, games: 64 });
  const team = await createTestTeam("plat");

  const result = await registerTeam(deps(), "plat", tournament.id, team.id, { starters: ["plat"], subs: [] });
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const [row] = await testDb.select().from(registrationPlayers).where(eq(registrationPlayers.registrationId, result.registrationId));
  expect(row).toMatchObject({ userId: "plat", tournamentId: tournament.id, isSub: false, active: true });
  expect(row!.snapshot).toMatchObject({
    userId: "plat",
    riotId: "plat#LAS",
    rank: { tier: "PLATINUM", division: "II" },
    summonerLevel: 187,
    rankedGames: 64,
  });
  const [registration] = await testDb.select().from(registrations).where(eq(registrations.id, result.registrationId));
  expect(registration!.status).toBe("pending");
  expect(await testDb.select().from(auditLog).where(eq(auditLog.action, "registration.created"))).toHaveLength(1);
});

test("takePlayerSnapshot returns null without a Riot account", async () => {
  await createTestUser("nolink");
  expect(await takePlayerSnapshot(deps(), "nolink", "peak_season")).toBeNull();
});

test("an ineligible roster is rejected with its failures", async () => {
  const tournament = await openTournament({
    eligibilityRules: [{ id: "cap", type: "player_rank_range", max: { tier: "EMERALD", division: "I" } }],
  });
  await linkedPlayer("cap", PLAT2);
  await linkedPlayer("smurf", DIA1);
  const team = await createTestTeam("cap", ["smurf"]);

  const result = await registerTeam(deps(), "cap", tournament.id, team.id, { starters: ["cap", "smurf"], subs: [] });
  expect(result).toMatchObject({ ok: false, reason: "ineligible", failures: [{ ruleId: "cap", userId: "smurf" }] });
  expect(await testDb.select().from(registrations)).toHaveLength(0);
  expect(await testDb.select().from(registrationPlayers)).toHaveLength(0);
});

test("rank changes after registering don't affect the stored snapshot", async () => {
  const tournament = await openTournament({
    eligibilityRules: [{ id: "cap", type: "player_rank_range", max: { tier: "EMERALD", division: "I" } }],
  });
  const { ids, team, captain } = await squad("p");
  const result = await registerTeam(deps(), captain, tournament.id, team.id, { starters: ids, subs: [] });
  expect(result.ok).toBe(true);
  if (!result.ok) return;

  const [account] = await testDb.select().from(riotAccounts).where(eq(riotAccounts.userId, "p2"));
  await testDb.insert(rankSnapshots).values({
    riotAccountId: account!.id,
    tier: "DIAMOND",
    division: "I",
    lp: 0,
    wins: 100,
    losses: 0,
    observedAt: new Date(),
  });

  const view = await getRegistrationView(testDb, result.registrationId);
  expect(view!.failures).toEqual([]);
  expect(view!.roster.find((p) => p.userId === "p2")!.rank).toMatchObject({ tier: "PLATINUM", division: "II" });
});

test("a player can't be on two active rosters in one tournament", async () => {
  const tournament = await openTournament();
  await linkedPlayer("both");
  await linkedPlayer("capA");
  await linkedPlayer("capB");
  const teamA = await createTestTeam("capA", ["both"]);
  const teamB = await createTestTeam("capB", ["both"]);

  const first = await registerTeam(deps(), "capA", tournament.id, teamA.id, { starters: ["capA", "both"], subs: [] });
  expect(first.ok).toBe(true);
  if (!first.ok) return;
  const roster = { starters: ["capB"], subs: ["both"] };
  expect(await registerTeam(deps(), "capB", tournament.id, teamB.id, roster)).toEqual({
    ok: false,
    reason: "player_already_registered",
  });

  expect(await withdrawRegistration(testDb, "capB", first.registrationId)).toEqual({ ok: false, reason: "not_captain" });
  expect(await withdrawRegistration(testDb, "capA", first.registrationId)).toEqual({ ok: true });
  expect((await registerTeam(deps(), "capB", tournament.id, teamB.id, roster)).ok).toBe(true);

  const withdrawn = await getRegistrationView(testDb, first.registrationId);
  expect(withdrawn!.status).toBe("withdrawn");
  expect(await testDb.select().from(auditLog).where(eq(auditLog.action, "registration.withdrawn"))).toHaveLength(1);
});

test("concurrent registrations sharing a player never both succeed", async () => {
  const tournament = await openTournament();
  await linkedPlayer("both");
  await linkedPlayer("capA");
  await linkedPlayer("capB");
  const teamA = await createTestTeam("capA", ["both"]);
  const teamB = await createTestTeam("capB", ["both"]);

  const results = await Promise.all([
    registerTeam(deps(), "capA", tournament.id, teamA.id, { starters: ["capA", "both"], subs: [] }),
    registerTeam(deps(), "capB", tournament.id, teamB.id, { starters: ["capB", "both"], subs: [] }),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "player_already_registered" });
});

test("a team can't register twice in one tournament", async () => {
  const tournament = await openTournament();
  const { team, captain } = await squad("p", 1);
  await createTestRegistration(tournament.id, team.id, { starters: [captain], subs: [] });
  expect(await registerTeam(deps(), captain, tournament.id, team.id, { starters: [captain], subs: [] })).toEqual({
    ok: false,
    reason: "already_registered",
  });
});

test("non-members, too many starters (6) and too many subs (maxSubs+1) are rejected", async () => {
  const tournament = await openTournament({ maxSubs: 1 });
  const { ids, team, captain } = await squad("p", 6);
  await linkedPlayer("outsider");
  await createTestUser("nolink");
  const register = (starters: string[], subs: string[] = []) =>
    registerTeam(deps(), captain, tournament.id, team.id, { starters, subs });

  expect(await register([captain, "outsider"])).toEqual({ ok: false, reason: "player_not_member" });
  expect(await register(ids)).toEqual({ ok: false, reason: "too_many_starters" });
  expect(await register(ids.slice(0, 4), ids.slice(4))).toEqual({ ok: false, reason: "too_many_subs" });
  expect(await registerTeam(deps(), "p2", tournament.id, team.id, { starters: ids.slice(0, 5), subs: [] })).toEqual({
    ok: false,
    reason: "not_captain",
  });
  expect(await testDb.select().from(registrations)).toHaveLength(0);
});

test("a roster player needs a linked Riot account", async () => {
  const tournament = await openTournament();
  const { team, captain } = await squad("p", 1);
  await createTestUser("nolink");
  await testDb.insert(teamMembers).values({ teamId: team.id, userId: "nolink", role: "member" });
  expect(await registerTeam(deps(), captain, tournament.id, team.id, { starters: [captain, "nolink"], subs: [] })).toEqual({
    ok: false,
    reason: "riot_required",
  });
});

test("registerTeam only works while registration is open", async () => {
  const draft = await createTestTournament();
  const { team, captain } = await squad("p", 1);
  expect(await registerTeam(deps(), captain, draft.id, team.id, { starters: [captain], subs: [] })).toEqual({
    ok: false,
    reason: "registration_closed",
  });
  const closed = await createTestTournament({ status: "registration_closed" });
  expect(await registerTeam(deps(), captain, closed.id, team.id, { starters: [captain], subs: [] })).toEqual({
    ok: false,
    reason: "registration_closed",
  });
});

test("updateRoster keeps existing snapshots and snapshots new players", async () => {
  const tournament = await openTournament({ maxSubs: 1 });
  const { ids, team, captain } = await squad("p", 6);
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: ids.slice(0, 4), subs: [] });
  const before = await getRegistrationView(testDb, registrationId);
  const keptBefore = before!.roster.find((p) => p.userId === "p2")!;

  // p4 is dropped, p5 joins as a starter, p6 as a sub.
  const roster = { starters: ["p1", "p2", "p3", "p5"], subs: ["p6"] };
  expect(await updateRoster(deps(), captain, registrationId, roster)).toEqual({ ok: true, registrationId });

  const after = await getRegistrationView(testDb, registrationId);
  expect(after!.roster.map((p) => [p.userId, p.isSub])).toEqual([
    ["p1", false],
    ["p2", false],
    ["p3", false],
    ["p5", false],
    ["p6", true],
  ]);
  expect(after!.roster.find((p) => p.userId === "p2")!.takenAt).toBe(keptBefore.takenAt);
  expect(after!.roster.find((p) => p.userId === "p5")!.rank).toMatchObject({ tier: "PLATINUM" });
  expect(await testDb.select().from(auditLog).where(eq(auditLog.action, "registration.roster_updated"))).toHaveLength(1);

  expect(await updateRoster(deps(), "p2", registrationId, roster)).toEqual({ ok: false, reason: "not_captain" });
  expect(await updateRoster(deps(), captain, registrationId, { starters: ids, subs: [] })).toEqual({
    ok: false,
    reason: "too_many_starters",
  });
});

test("updateRoster re-checks eligibility and is locked once the tournament starts", async () => {
  const tournament = await openTournament({
    eligibilityRules: [{ id: "cap", type: "player_rank_range", max: { tier: "EMERALD", division: "I" } }],
  });
  const { team, captain } = await squad("p", 2);
  await linkedPlayer("smurf", DIA1);
  await testDb.insert(teamMembers).values({ teamId: team.id, userId: "smurf", role: "member" });
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: [captain], subs: [] });

  expect(await updateRoster(deps(), captain, registrationId, { starters: [captain, "smurf"], subs: [] })).toMatchObject({
    ok: false,
    reason: "ineligible",
    failures: [{ ruleId: "cap", userId: "smurf" }],
  });

  await testDb.update(tournaments).set({ status: "registration_closed" }).where(eq(tournaments.id, tournament.id));
  expect((await updateRoster(deps(), captain, registrationId, { starters: [captain, "p2"], subs: [] })).ok).toBe(true);

  await testDb.update(tournaments).set({ status: "check_in" }).where(eq(tournaments.id, tournament.id));
  expect(await updateRoster(deps(), captain, registrationId, { starters: [captain], subs: [] })).toEqual({
    ok: false,
    reason: "locked",
  });
  expect(await withdrawRegistration(testDb, captain, registrationId)).toEqual({ ok: false, reason: "locked" });
});

test("a confirmed registration can't drop below a full roster", async () => {
  const tournament = await openTournament();
  const { ids, team, captain } = await squad("p", 5);
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: ids, subs: [] });
  await testDb.update(registrations).set({ status: "confirmed" }).where(eq(registrations.id, registrationId));
  expect(await updateRoster(deps(), captain, registrationId, { starters: ids.slice(0, 4), subs: [] })).toEqual({
    ok: false,
    reason: "would_unconfirm",
  });
});

test("rank source current refreshes from Riot first", async () => {
  const tournament = await openTournament({ rankSource: "current" });
  await linkedPlayer("cur", PLAT2);
  riot.addAccount({ puuid: "puuid-cur", gameName: "cur", tagLine: "LAS", summonerLevel: 250 });
  riot.setRank("puuid-cur", { ...DIA1, wins: 30, losses: 20 });
  const team = await createTestTeam("cur");

  const result = await registerTeam(deps(), "cur", tournament.id, team.id, { starters: ["cur"], subs: [] });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const view = await getRegistrationView(testDb, result.registrationId);
  expect(view!.roster[0]).toMatchObject({ rank: { tier: "DIAMOND", division: "I" }, summonerLevel: 250, rankedGames: 50 });
});

test("rank source current falls back to the stored snapshot when Riot is unavailable", async () => {
  await linkedPlayer("cur", PLAT2, { level: 99, games: 12 });
  riot.addAccount({ puuid: "puuid-cur", gameName: "cur", tagLine: "LAS", summonerLevel: 250 });
  riot.setRank("puuid-cur", { ...DIA1, wins: 30, losses: 20 });
  riot.setUnavailable("puuid-cur");

  const snapshot = await takePlayerSnapshot(deps(), "cur", "current");
  expect(snapshot).toMatchObject({ rank: { tier: "PLATINUM", division: "II" }, summonerLevel: 99, rankedGames: 12 });
});

test("leaving the team drops the player from a pending roster", async () => {
  const tournament = await openTournament();
  const { team, captain } = await squad("p", 3);
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: ["p1", "p2", "p3"], subs: [] });

  expect(await leaveTeam(testDb, "p2", team.id)).toEqual({ ok: true });
  expect(await removeMember(testDb, captain, team.id, "p3")).toEqual({ ok: true });
  const view = await getRegistrationView(testDb, registrationId);
  expect(view!.roster.map((p) => p.userId)).toEqual(["p1"]);

  // Dropped players are free to join another roster in the same tournament.
  const other = await createTestTeam("p2");
  expect((await registerTeam(deps(), "p2", tournament.id, other.id, { starters: ["p2"], subs: [] })).ok).toBe(true);
});

test("a player on a confirmed roster can't leave or be removed", async () => {
  const tournament = await openTournament();
  const { ids, team, captain } = await squad("p", 5);
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: ids, subs: [] });
  await testDb.update(registrations).set({ status: "confirmed" }).where(eq(registrations.id, registrationId));

  expect(await leaveTeam(testDb, "p2", team.id)).toEqual({ ok: false, reason: "on_confirmed_roster" });
  expect(await removeMember(testDb, captain, team.id, "p3")).toEqual({ ok: false, reason: "on_confirmed_roster" });
  expect((await getRegistrationView(testDb, registrationId))!.roster).toHaveLength(5);
});

test("views expose team, roster and ordering", async () => {
  const tournament = await openTournament();
  const a = await squad("a", 1);
  const b = await squad("b", 1);
  const c = await squad("c", 1);
  const regA = await createTestRegistration(tournament.id, a.team.id, { starters: ["a1"], subs: [] });
  const regB = await createTestRegistration(tournament.id, b.team.id, { starters: ["b1"], subs: [] });
  const regC = await createTestRegistration(tournament.id, c.team.id, { starters: ["c1"], subs: [] });
  await withdrawRegistration(testDb, "a1", regA);
  await testDb.update(registrations).set({ status: "confirmed" }).where(eq(registrations.id, regC));

  const list = await listRegistrations(testDb, tournament.id);
  expect(list.map((r) => [r.id, r.status])).toEqual([
    [regC, "confirmed"],
    [regB, "pending"],
    [regA, "withdrawn"],
  ]);
  const view = await getRegistrationForTeam(testDb, tournament.id, b.team.slug);
  expect(view).toMatchObject({
    id: regB,
    tournamentId: tournament.id,
    team: { id: b.team.id, slug: b.team.slug, captainUserId: "b1" },
    paidCount: 0,
    failures: [],
  });
  expect(view!.roster[0]).toMatchObject({ userId: "b1", paid: false, isSub: false });
  expect(await getRegistrationForTeam(testDb, tournament.id, "nope")).toBeNull();
  expect(await getRegistrationView(testDb, crypto.randomUUID())).toBeNull();
});

test("updateRoster hooks run in the same transaction", async () => {
  const tournament = await openTournament({
    eligibilityRules: [{ id: "r1", type: "player_rank_range", max: { tier: "GOLD", division: "I" } }],
  });
  const { team, captain, ids } = await squad("h", 2, { tier: "GOLD", division: "II", lp: 0 });
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: ids, subs: [] });
  await linkedPlayer("newbie", DIA1);
  const hook = async (tx: Parameters<NonNullable<NonNullable<Parameters<typeof updateRoster>[4]>["inTransaction"]>>[0]) => {
    await tx.insert(teamMembers).values({ teamId: team.id, userId: "newbie", role: "member" });
  };
  const result = await updateRoster(deps(), captain, registrationId, { starters: [...ids, "newbie"], subs: [] }, { joining: ["newbie"], inTransaction: hook });
  expect(result).toMatchObject({ ok: false, reason: "ineligible" });
  expect(await testDb.select().from(teamMembers).where(eq(teamMembers.userId, "newbie"))).toHaveLength(0);

  // a rejection found after the hook ran also rolls the hook back: the hook forgets to add "ok" as a member
  await linkedPlayer("ok", { tier: "GOLD", division: "III", lp: 0 });
  await linkedPlayer("other", { tier: "GOLD", division: "III", lp: 0 });
  const forgetful = await updateRoster(deps(), captain, registrationId, { starters: [...ids, "ok"], subs: [] }, {
    joining: ["ok"],
    inTransaction: async (tx) => {
      await tx.insert(teamMembers).values({ teamId: team.id, userId: "other", role: "member" });
    },
  });
  expect(forgetful).toMatchObject({ ok: false, reason: "player_not_member" });
  expect(await testDb.select().from(teamMembers).where(eq(teamMembers.userId, "other"))).toHaveLength(0);

  const accepted = await updateRoster(deps(), captain, registrationId, { starters: [...ids, "ok"], subs: [] }, {
    joining: ["ok"],
    inTransaction: async (tx) => {
      await tx.insert(teamMembers).values({ teamId: team.id, userId: "ok", role: "member" });
    },
  });
  expect(accepted.ok).toBe(true);
  expect(await testDb.select().from(teamMembers).where(eq(teamMembers.userId, "ok"))).toHaveLength(1);
});
