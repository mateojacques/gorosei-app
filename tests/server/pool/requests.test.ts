import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { teamRequests, tournaments } from "../../../src/server/db/schema";
import { leavePool, listPool } from "../../../src/server/pool/pool";
import { listOpenTeams, recruitFromPool, requestFromPool } from "../../../src/server/pool/requests";
import { unmarkPaid } from "../../../src/server/tournaments/confirmations";
import type { Rank } from "../../../src/shared/rank";
import { createTestRegistration, createTestTeam, createTestTournament, linkedPlayer, poolPlayer } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

const GOLD4: Rank = { tier: "GOLD", division: "IV", lp: 0 };
const GOLD1: Rank = { tier: "GOLD", division: "I", lp: 0 };
const DIAMOND1: Rank = { tier: "DIAMOND", division: "I", lp: 0 };

beforeEach(resetTestDb);

const openTournament = (overrides: Parameters<typeof createTestTournament>[0] = {}) =>
  createTestTournament({ status: "registration_open", ...overrides });

/** A registered (pending) team of `count` starters `${prefix}1..n`, captained by the first. */
async function openTeam(tournamentId: string, prefix: string, count = 4, rank: Rank | null = GOLD1) {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) ids.push(await linkedPlayer(`${prefix}${i}`, rank));
  const team = await createTestTeam(ids[0]!, ids.slice(1));
  const registrationId = await createTestRegistration(tournamentId, team.id, { starters: ids, subs: [] });
  return { ids, team, captain: ids[0]!, registrationId };
}

test("listPool returns only available players", async () => {
  const tournament = await openTournament();
  const admin = await createTestUser("admin");
  for (const id of ["a", "b", "c", "d"]) await poolPlayer(tournament, id, GOLD1);
  expect((await listPool(testDb, tournament.id)).map((p) => p.userId).sort()).toEqual(["a", "b", "c", "d"]);

  await unmarkPaid(testDb, admin, tournament.id, "a");
  await leavePool(testDb, "b", tournament.id);
  const team = await createTestTeam("c");
  await createTestRegistration(tournament.id, team.id, { starters: ["c"], subs: [] });
  expect((await listPool(testDb, tournament.id)).map((p) => p.userId)).toEqual(["d"]);
});

test("listPool filters by role and rank", async () => {
  const tournament = await openTournament();
  await poolPlayer(tournament, "jg-gold", GOLD1, ["jungle", "top"]);
  await poolPlayer(tournament, "jg-dia", DIAMOND1, ["jungle"]);
  await poolPlayer(tournament, "mid-low", GOLD4, ["mid"]);
  const jungle = await listPool(testDb, tournament.id, { role: "jungle" });
  expect(jungle.map((p) => p.userId)).toEqual(["jg-dia", "jg-gold"]);
  const ranked = await listPool(testDb, tournament.id, { minRank: GOLD4 });
  expect(ranked.map((p) => p.userId).sort()).toEqual(["jg-dia", "jg-gold", "mid-low"]);
  const capped = await listPool(testDb, tournament.id, { role: "jungle", maxRank: GOLD1 });
  expect(capped.map((p) => p.userId)).toEqual(["jg-gold"]);
  expect((await listPool(testDb, tournament.id, { minRank: GOLD1 })).map((p) => p.userId)).toEqual(["jg-dia", "jg-gold"]);
});

test("listOpenTeams hides teams the player would break", async () => {
  const tournament = await openTournament({
    eligibilityRules: [{ id: "above", type: "max_players_above", count: 1, above: { tier: "EMERALD", division: "I" } }],
  });
  await openTeam(tournament.id, "dia", 3);
  // one DIAMOND starter on the team already
  const diamondCaptain = await linkedPlayer("dcap", DIAMOND1);
  const team = await createTestTeam(diamondCaptain, []);
  const diamondRegistration = await createTestRegistration(tournament.id, team.id, { starters: [diamondCaptain], subs: [] });
  await openTeam(tournament.id, "full", 5);

  await poolPlayer(tournament, "diamond-agent", DIAMOND1);
  await poolPlayer(tournament, "gold-agent", GOLD1);
  const forDiamond = await listOpenTeams(testDb, tournament.id, "diamond-agent");
  expect(forDiamond.map((t) => t.registrationId)).not.toContain(diamondRegistration);
  const forGold = await listOpenTeams(testDb, tournament.id, "gold-agent");
  expect(forGold.map((t) => t.registrationId)).toContain(diamondRegistration);
  expect(forGold.map((t) => t.starterCount).every((n) => n < 5)).toBe(true);
  expect(forGold).toHaveLength(2);
  expect(forGold.find((t) => t.registrationId === diamondRegistration)).toMatchObject({ captainRiotId: "dcap#LAS", starterCount: 1 });
});

test("requestFromPool creates a join request with the tournament id", async () => {
  const tournament = await openTournament();
  const { registrationId, team } = await openTeam(tournament.id, "t");
  await poolPlayer(tournament, "agent", GOLD1);

  const result = await requestFromPool(testDb, "agent", registrationId);
  expect(result.ok).toBe(true);
  const [row] = await testDb.select().from(teamRequests).where(eq(teamRequests.userId, "agent"));
  expect(row).toMatchObject({ teamId: team.id, kind: "join_request", status: "pending", tournamentId: tournament.id });
  expect(await requestFromPool(testDb, "agent", registrationId)).toEqual({ ok: false, reason: "already_pending" });
});

test("requestFromPool refuses players outside the pool and full rosters", async () => {
  const tournament = await openTournament();
  const open = await openTeam(tournament.id, "t");
  const full = await openTeam(tournament.id, "f", 5);
  await linkedPlayer("outsider", GOLD1);
  expect(await requestFromPool(testDb, "outsider", open.registrationId)).toEqual({ ok: false, reason: "not_in_pool" });
  await poolPlayer(tournament, "agent", GOLD1);
  expect(await requestFromPool(testDb, "agent", full.registrationId)).toEqual({ ok: false, reason: "roster_full" });
  expect(await requestFromPool(testDb, "agent", crypto.randomUUID())).toEqual({ ok: false, reason: "team_not_registered" });
});

test("requestFromPool refuses a player who would break the rules", async () => {
  const tournament = await openTournament({
    eligibilityRules: [{ id: "above", type: "max_players_above", count: 0, above: { tier: "EMERALD", division: "I" } }],
  });
  const { registrationId } = await openTeam(tournament.id, "t");
  await poolPlayer(tournament, "dia", DIAMOND1);
  const result = await requestFromPool(testDb, "dia", registrationId);
  expect(result).toMatchObject({ ok: false, reason: "ineligible" });
});

test("recruitFromPool is captain-only", async () => {
  const tournament = await openTournament();
  const { registrationId, captain, ids } = await openTeam(tournament.id, "t");
  await poolPlayer(tournament, "agent", GOLD1);
  expect(await recruitFromPool(testDb, ids[1]!, registrationId, "agent")).toEqual({ ok: false, reason: "not_captain" });
  const result = await recruitFromPool(testDb, captain, registrationId, "agent");
  expect(result.ok).toBe(true);
  const [row] = await testDb.select().from(teamRequests).where(eq(teamRequests.userId, "agent"));
  expect(row).toMatchObject({ kind: "invite", status: "pending", tournamentId: tournament.id });
  expect(await recruitFromPool(testDb, captain, registrationId, "agent")).toEqual({ ok: false, reason: "already_pending" });
});

test("recruitFromPool refuses unavailable players, team members and rule breakers", async () => {
  const tournament = await openTournament({
    eligibilityRules: [{ id: "above", type: "max_players_above", count: 0, above: { tier: "EMERALD", division: "I" } }],
  });
  const { registrationId, captain, ids } = await openTeam(tournament.id, "t");
  await linkedPlayer("outsider", GOLD1);
  expect(await recruitFromPool(testDb, captain, registrationId, "outsider")).toEqual({ ok: false, reason: "not_in_pool" });
  expect(await recruitFromPool(testDb, captain, registrationId, ids[1]!)).toEqual({ ok: false, reason: "already_member" });

  // a member of the team who is in the pool too is still a member
  await poolPlayer(tournament, "dia", DIAMOND1);
  const broken = await recruitFromPool(testDb, captain, registrationId, "dia");
  expect(broken).toMatchObject({ ok: false, reason: "ineligible" });
  if (!broken.ok) expect(broken.failures?.length).toBeGreaterThan(0);
});

test("requests are refused once registration is closed", async () => {
  const tournament = await openTournament();
  const { registrationId, captain } = await openTeam(tournament.id, "t");
  await poolPlayer(tournament, "agent", GOLD1);
  await testDb.update(tournaments).set({ status: "registration_closed" });
  expect(await requestFromPool(testDb, "agent", registrationId)).toEqual({ ok: false, reason: "closed" });
  expect(await recruitFromPool(testDb, captain, registrationId, "agent")).toEqual({ ok: false, reason: "closed" });
});
