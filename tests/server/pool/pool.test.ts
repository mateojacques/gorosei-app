import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, entryPayments, tournaments } from "../../../src/server/db/schema";
import { countPool, enterPool, getPoolEntry, leavePool, listPoolForAdmin, removeFromPool } from "../../../src/server/pool/pool";
import { getPoolPage } from "../../../src/server/pool/pool-view";
import { requestFromPool, respondToPoolRequest } from "../../../src/server/pool/requests";
import { closeRegistration } from "../../../src/server/tournaments/credits";
import { markPaid, unmarkPaid } from "../../../src/server/tournaments/confirmations";
import type { Rank } from "../../../src/shared/rank";
import { createTestRegistration, createTestTeam, createTestTournament, linkedPlayer, payFor, poolPlayer } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

const GOLD1: Rank = { tier: "GOLD", division: "I", lp: 0 };
const MASTER: Rank = { tier: "MASTER", division: "I", lp: 100 };
const DIAMOND4: Rank = { tier: "DIAMOND", division: "IV", lp: 0 };

const deps = () => ({ db: testDb, riot: new FakeRiotClient() });
const input = { roles: ["mid" as const, "top" as const], autoPlace: true };
const openTournament = (overrides: Parameters<typeof createTestTournament>[0] = {}) =>
  createTestTournament({ status: "registration_open", ...overrides });

beforeEach(resetTestDb);

test("entering requires an open registration", async () => {
  const tournament = await createTestTournament({ status: "registration_closed" });
  await linkedPlayer("p1", GOLD1);
  await payFor(tournament.id, "p1");
  expect(await enterPool(deps(), "p1", tournament.id, input)).toEqual({ ok: false, reason: "registration_closed" });
});

test("entering requires a linked Riot account", async () => {
  const tournament = await openTournament();
  await createTestUser("nolink");
  expect(await enterPool(deps(), "nolink", tournament.id, input)).toEqual({ ok: false, reason: "riot_required" });
});

test("entering requires a live payment", async () => {
  const tournament = await openTournament();
  await linkedPlayer("p1", GOLD1);
  expect(await enterPool(deps(), "p1", tournament.id, input)).toEqual({ ok: false, reason: "not_paid" });
  await payFor(tournament.id, "p1");
  expect(await enterPool(deps(), "p1", tournament.id, input)).toEqual({ ok: true });
  expect(await getPoolEntry(testDb, tournament.id, "p1")).toMatchObject({ roles: ["mid", "top"], autoPlace: true, active: true });
});

test("a free tournament needs no payment", async () => {
  const tournament = await openTournament({ entryFeeArs: 0 });
  await linkedPlayer("p1", GOLD1);
  expect(await enterPool(deps(), "p1", tournament.id, input)).toEqual({ ok: true });
  expect(await countPool(testDb, tournament.id)).toBe(1);
});

test("a forfeited payment does not let a player enter", async () => {
  const tournament = await openTournament();
  await linkedPlayer("p1", GOLD1);
  await payFor(tournament.id, "p1");
  await testDb.update(entryPayments).set({ forfeited: true }).where(eq(entryPayments.userId, "p1"));
  expect(await enterPool(deps(), "p1", tournament.id, input)).toEqual({ ok: false, reason: "not_paid" });
});

test("entering is blocked for a player on an active roster", async () => {
  const tournament = await openTournament();
  await linkedPlayer("c", GOLD1);
  const team = await createTestTeam("c");
  await createTestRegistration(tournament.id, team.id, { starters: ["c"], subs: [] });
  await payFor(tournament.id, "c");
  expect(await enterPool(deps(), "c", tournament.id, input)).toEqual({ ok: false, reason: "already_on_roster" });
});

test("a player who breaks a per-player rule is rejected with the failures", async () => {
  const tournament = await openTournament({
    eligibilityRules: [{ id: "r1", type: "player_rank_range", max: { tier: "DIAMOND", division: "IV" } }],
  });
  await linkedPlayer("m", MASTER);
  await linkedPlayer("d", DIAMOND4);
  await payFor(tournament.id, "m");
  await payFor(tournament.id, "d");
  const rejected = await enterPool(deps(), "m", tournament.id, input);
  expect(rejected).toMatchObject({ ok: false, reason: "ineligible" });
  if (!rejected.ok) expect(rejected.failures?.[0]?.messageKey).toBe("eligibility.fail.rank_above");
  expect(await enterPool(deps(), "d", tournament.id, input)).toEqual({ ok: true });
});

test("invalid roles are rejected", async () => {
  const tournament = await openTournament();
  await linkedPlayer("p1", GOLD1);
  await payFor(tournament.id, "p1");
  expect(await enterPool(deps(), "p1", tournament.id, { roles: [], autoPlace: true })).toEqual({ ok: false, reason: "invalid_roles" });
});

test("re-entering keeps joined_at and updates roles", async () => {
  const tournament = await openTournament();
  await poolPlayer(tournament, "p1", GOLD1, ["mid"]);
  const before = await getPoolEntry(testDb, tournament.id, "p1");
  await Bun.sleep(5);
  expect(await enterPool(deps(), "p1", tournament.id, { roles: ["support", "bot"], autoPlace: false })).toEqual({ ok: true });
  const after = await getPoolEntry(testDb, tournament.id, "p1");
  expect(after!.joinedAt).toEqual(before!.joinedAt);
  expect(after).toMatchObject({ roles: ["support", "bot"], autoPlace: false });
});

test("leaving requires an open registration", async () => {
  const tournament = await openTournament();
  await poolPlayer(tournament, "p1", GOLD1);
  expect(await leavePool(testDb, "nobody", tournament.id)).toEqual({ ok: false, reason: "not_in_pool" });
  expect(await leavePool(testDb, "p1", tournament.id)).toEqual({ ok: true });
  expect(await countPool(testDb, tournament.id)).toBe(0);
  expect(await leavePool(testDb, "p1", tournament.id)).toEqual({ ok: false, reason: "not_in_pool" });
  const actions = (await testDb.select().from(auditLog)).map((r) => r.action);
  expect(actions).toContain("pool.entered");
  expect(actions).toContain("pool.left");

  await poolPlayer(tournament, "p2", GOLD1);
  await testDb.update(tournaments).set({ status: "registration_closed" });
  expect(await leavePool(testDb, "p2", tournament.id)).toEqual({ ok: false, reason: "registration_closed" });
  expect(await testDb.select().from(entryPayments).where(eq(entryPayments.userId, "p2"))).toHaveLength(1);
});

test("countPool counts only paid, active, unrostered entries", async () => {
  const tournament = await openTournament();
  const admin = await createTestUser("admin");
  for (const id of ["a", "b", "c"]) await poolPlayer(tournament, id, GOLD1);
  expect(await countPool(testDb, tournament.id)).toBe(3);

  await unmarkPaid(testDb, admin, tournament.id, "a");
  expect(await countPool(testDb, tournament.id)).toBe(2);

  const team = await createTestTeam("b");
  await createTestRegistration(tournament.id, team.id, { starters: ["b"], subs: [] });
  expect(await countPool(testDb, tournament.id)).toBe(1);

  // a forfeited payment drops out too, and re-marking brings the player back
  await testDb.update(entryPayments).set({ forfeited: true }).where(eq(entryPayments.userId, "c"));
  expect(await countPool(testDb, tournament.id)).toBe(0);
  await markPaid(testDb, admin, tournament.id, ["c"], "again");
  expect(await countPool(testDb, tournament.id)).toBe(1);
});

// --- read model ---

test("getPoolPage reports each viewer state", async () => {
  const tournament = await openTournament({
    eligibilityRules: [{ id: "r1", type: "player_rank_range", max: { tier: "DIAMOND", division: "IV" } }],
  });
  const page = (viewer: string | null) => getPoolPage(testDb, tournament.slug, viewer);
  expect((await page(null))!.viewer.kind).toBe("signed_out");
  await createTestUser("noriot");
  expect((await page("noriot"))!.viewer.kind).toBe("no_riot");
  await linkedPlayer("unpaid", GOLD1);
  expect((await page("unpaid"))!.viewer.kind).toBe("unpaid");
  await linkedPlayer("master", MASTER);
  await payFor(tournament.id, "master");
  const ineligible = (await page("master"))!.viewer;
  expect(ineligible.kind).toBe("ineligible");
  await linkedPlayer("fresh", GOLD1);
  await payFor(tournament.id, "fresh");
  expect((await page("fresh"))!.viewer.kind).toBe("can_enter");

  // a team missing a player, and a pool player who sees it
  for (const id of ["c1", "c2", "c3", "c4"]) await linkedPlayer(id, GOLD1);
  const team = await createTestTeam("c1", ["c2", "c3", "c4"]);
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: ["c1", "c2", "c3", "c4"], subs: [] });
  await poolPlayer(tournament, "agent", GOLD1, ["jungle"]);
  const inPool = (await page("agent"))!.viewer;
  expect(inPool.kind).toBe("in_pool");
  if (inPool.kind === "in_pool") {
    expect(inPool.entry.roles).toEqual(["jungle"]);
    expect(inPool.openTeams.map((t) => t.registrationId)).toEqual([registrationId]);
  }
  expect((await page("agent"))!.tournament.poolCount).toBe(1);

  // joining a team makes the player "placed"
  const request = await requestFromPool(testDb, "agent", registrationId);
  if (!request.ok) throw new Error("request failed");
  await respondToPoolRequest({ db: testDb, riot: new FakeRiotClient() }, "c1", request.requestId, true);
  const placed = (await page("agent"))!.viewer;
  expect(placed.kind).toBe("placed");
  if (placed.kind === "placed") expect(placed.team.mates).toHaveLength(4);

  // after close an unpaid-for-a-team pool player is unplaced with a credit
  await poolPlayer(tournament, "left-out", GOLD1);
  await closeRegistration(testDb, tournament.id, new Date("2026-10-30T20:00:00Z"), null);
  expect((await page("left-out"))!.viewer).toEqual({ kind: "unplaced", creditGranted: true });
  expect((await page("unpaid"))!.viewer.kind).toBe("closed");
});

test("captain is null unless the viewer captains a pending team with fewer than five starters", async () => {
  const tournament = await openTournament();
  for (const id of ["c1", "c2", "c3", "c4", "c5"]) await linkedPlayer(id, GOLD1);
  const missing = await createTestTeam("c1", ["c2", "c3"]);
  await createTestRegistration(tournament.id, missing.id, { starters: ["c1", "c2", "c3"], subs: [] });
  const full = await createTestTeam("c4", ["c5"]);
  await createTestRegistration(tournament.id, full.id, { starters: ["c4", "c5"], subs: [] });
  await poolPlayer(tournament, "agent", GOLD1);
  const view = await getPoolPage(testDb, tournament.slug, "c1");
  expect(view!.captain).toMatchObject({ teamName: expect.any(String), missing: 2 });
  expect(view!.captain!.pool.map((p) => p.userId)).toEqual(["agent"]);
  expect((await getPoolPage(testDb, tournament.slug, "agent"))!.captain).toBeNull();
  expect((await getPoolPage(testDb, tournament.slug, null))!.captain).toBeNull();
});

// --- admin tools ---

test("removeFromPool deactivates the entry, keeps the payment and audits the reason", async () => {
  const tournament = await openTournament();
  const admin = await createTestUser("admin");
  await poolPlayer(tournament, "p1", GOLD1);
  expect(await removeFromPool(testDb, admin, tournament.id, "nobody", "x")).toEqual({ ok: false, reason: "not_in_pool" });
  expect(await removeFromPool(testDb, admin, tournament.id, "p1", "spam")).toEqual({ ok: true });
  expect(await countPool(testDb, tournament.id)).toBe(0);
  expect(await testDb.select().from(entryPayments).where(eq(entryPayments.userId, "p1"))).toHaveLength(1);
  const [audit] = await testDb.select().from(auditLog).where(eq(auditLog.action, "pool.removed"));
  expect(audit!.data).toMatchObject({ userId: "p1", reason: "spam" });
  expect(audit!.actorUserId).toBe(admin);
});

test("listPoolForAdmin includes unpaid and rostered entries with their state", async () => {
  const tournament = await openTournament();
  const admin = await createTestUser("admin");
  for (const id of ["avail", "unpaid", "rostered", "gone"]) await poolPlayer(tournament, id, GOLD1);
  await unmarkPaid(testDb, admin, tournament.id, "unpaid");
  const team = await createTestTeam("rostered");
  await createTestRegistration(tournament.id, team.id, { starters: ["rostered"], subs: [] });
  await leavePool(testDb, "gone", tournament.id);

  const rows = await listPoolForAdmin(testDb, tournament.id);
  const byId = Object.fromEntries(rows.map((r) => [r.riotId.split("#")[0]!, r]));
  expect(rows).toHaveLength(4);
  expect(byId.avail).toMatchObject({ paid: true, state: "available", autoPlace: true, roles: ["mid"] });
  expect(byId.unpaid).toMatchObject({ paid: false, state: "available" });
  expect(byId.rostered).toMatchObject({ paid: true, state: "on_roster" });
  expect(byId.gone).toMatchObject({ state: "left" });
});
