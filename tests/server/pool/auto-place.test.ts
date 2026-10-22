import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  auditLog,
  registrationPlayers,
  registrations,
  teamMembers,
  teams,
  tournaments,
} from "../../../src/server/db/schema";
import { autoPlacePool, planPoolPlacement } from "../../../src/server/pool/auto-place";
import { unmarkPaid } from "../../../src/server/tournaments/confirmations";
import type { Rank } from "../../../src/shared/rank";
import { createTestRegistration, createTestTeam, createTestTournament, poolPlayer } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

const GOLD: Rank = { tier: "GOLD", division: "II", lp: 0 };
const PLAT: Rank = { tier: "PLATINUM", division: "I", lp: 0 };
const NOW = new Date("2026-10-30T20:00:00Z");

beforeEach(resetTestDb);

const openTournament = (overrides: Parameters<typeof createTestTournament>[0] = {}) =>
  createTestTournament({ status: "registration_open", ...overrides });

async function fillPool(tournament: { id: string }, count: number, prefix = "p") {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `${prefix}${String(i).padStart(2, "0")}`;
    ids.push(await poolPlayer(tournament, id, i === 0 ? PLAT : GOLD, [(["top", "jungle", "mid", "bot", "support"] as const)[i % 5]!]));
    await Bun.sleep(2);
  }
  return ids;
}

test("planPoolPlacement ignores unpaid, opted-out, rostered and rule-breaking players", async () => {
  const tournament = await openTournament();
  const admin = await createTestUser("admin");
  const ids = await fillPool(tournament, 11);
  await poolPlayer(tournament, "optout", GOLD, ["mid"], { autoPlace: false });
  await poolPlayer(tournament, "unpaid", GOLD);
  await unmarkPaid(testDb, admin, tournament.id, "unpaid");
  await poolPlayer(tournament, "rostered", GOLD);
  const team = await createTestTeam("rostered");
  await createTestRegistration(tournament.id, team.id, { starters: ["rostered"], subs: [] });
  // the rules tightened after p00 (PLATINUM) entered
  await testDb
    .update(tournaments)
    .set({ eligibilityRules: [{ id: "r", type: "player_rank_range", max: { tier: "GOLD", division: "I" } }] })
    .where(eq(tournaments.id, tournament.id));
  const [current] = await testDb.select().from(tournaments).where(eq(tournaments.id, tournament.id));

  const plan = await planPoolPlacement(testDb, current!, NOW);
  expect(plan.failing).toEqual(["p00"]);
  const placed = plan.plan.teams.flatMap((t) => t.members.map((m) => m.userId));
  expect(placed.sort()).toEqual(ids.slice(1));
  expect(plan.plan.unplacedUserIds).toEqual([]);
  expect(plan.riotIds.get("p01")).toBe("p01#LAS");
});

test("autoPlacePool creates auto-formed teams with the highest-ranked player as captain", async () => {
  const tournament = await openTournament();
  const ids = await fillPool(tournament, 10);
  const result = await testDb.transaction((tx) => autoPlacePool(tx, tournament, NOW));
  expect(result).toEqual({ teams: 2, placed: 10 });

  const created = await testDb.select().from(teams);
  expect(created.map((t) => t.name).sort()).toEqual([
    `Agentes libres ${tournament.edition}-1`,
    `Agentes libres ${tournament.edition}-2`,
  ]);
  expect(created.every((t) => t.autoFormedTournamentId === tournament.id && /^AL[A-Z0-9]+$/.test(t.tag))).toBe(true);
  const top = created.find((t) => t.captainUserId === "p00");
  expect(top).toBeDefined();
  const members = await testDb.select().from(teamMembers);
  expect(members).toHaveLength(10);
  expect(members.filter((m) => m.role === "captain")).toHaveLength(2);
  const roster = await testDb.select().from(registrationPlayers);
  expect(roster.map((r) => r.userId).sort()).toEqual(ids);
  expect(roster.every((r) => !r.isSub && r.active && r.snapshot.riotId.endsWith("#LAS"))).toBe(true);
  const regs = await testDb.select().from(registrations);
  expect(regs.every((r) => r.status === "pending")).toBe(true);
  expect(await testDb.select().from(auditLog).where(eq(auditLog.action, "pool.auto_placed"))).toHaveLength(2);
});
