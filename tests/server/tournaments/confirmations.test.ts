import { beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { auditLog, entryPayments, registrationPlayers, registrations } from "../../../src/server/db/schema";
import { leaveTeam } from "../../../src/server/teams/teams";
import {
  forceRemoveRegistration,
  grantEligibilityException,
  markPaid,
  revokeEligibilityException,
  unmarkPaid,
} from "../../../src/server/tournaments/confirmations";
import { getRegistrationView, updateRoster, withdrawRegistration } from "../../../src/server/tournaments/registrations";
import { updateTournament } from "../../../src/server/tournaments/tournaments";
import type { Tournament } from "../../../src/server/tournaments/tournaments";
import type { Rank } from "../../../src/shared/rank";
import type { TournamentInput } from "../../../src/shared/tournament";
import {
  baseTournamentInput,
  createTestRegistration,
  createTestTeam,
  createTestTournament,
  linkedPlayer,
} from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

const PLAT2: Rank = { tier: "PLATINUM", division: "II", lp: 40 };
const DIA1: Rank = { tier: "DIAMOND", division: "I", lp: 10 };

let admin: string;

beforeEach(async () => {
  await resetTestDb();
  admin = await createTestUser("admin");
});

/** Creates `count` linked players named `${prefix}1..n`; the first one captains a team with the rest. */
async function squad(prefix: string, count = 5, rank: Rank | null = PLAT2) {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) ids.push(await linkedPlayer(`${prefix}${i}`, rank));
  const team = await createTestTeam(ids[0]!, ids.slice(1));
  return { ids, team, captain: ids[0]! };
}

/** A squad registered with its first five players as starters and the rest as subs. */
async function registered(tournamentId: string, prefix: string, count = 5) {
  const s = await squad(prefix, count);
  const registrationId = await createTestRegistration(tournamentId, s.team.id, {
    starters: s.ids.slice(0, 5),
    subs: s.ids.slice(5),
  });
  return { ...s, registrationId };
}

const openTournament = (overrides: Parameters<typeof createTestTournament>[0] = {}) =>
  createTestTournament({ status: "registration_open", ...overrides });

async function statusOf(registrationId: string) {
  const [row] = await testDb.select({ status: registrations.status }).from(registrations).where(eq(registrations.id, registrationId));
  return row!.status;
}

const audits = (action: string, entityId?: string) =>
  testDb
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, action), entityId ? eq(auditLog.entityId, entityId) : undefined));

function inputOf(tournament: Tournament, overrides: Partial<TournamentInput>): TournamentInput {
  const input = Object.fromEntries(
    Object.keys(baseTournamentInput).map((key) => [key, tournament[key as keyof Tournament]]),
  ) as TournamentInput;
  return { ...input, ...overrides };
}

test("a team is confirmed when 5 roster players are paid", async () => {
  const tournament = await openTournament();
  const { ids, registrationId } = await registered(tournament.id, "p");

  expect(await markPaid(testDb, admin, tournament.id, ids.slice(0, 4), "MP-1")).toEqual({ ok: true, marked: 4 });
  let view = await getRegistrationView(testDb, registrationId);
  expect(view!.status).toBe("pending");
  expect(`${view!.paidCount}/5`).toBe("4/5");
  expect(view!.roster.filter((p) => p.paid).map((p) => p.userId)).toEqual(ids.slice(0, 4));
  expect(await audits("payment.marked")).toHaveLength(4);

  // Already-paid players are skipped.
  expect(await markPaid(testDb, admin, tournament.id, [ids[0]!, ids[4]!], "MP-2")).toEqual({ ok: true, marked: 1 });
  view = await getRegistrationView(testDb, registrationId);
  expect(view!.status).toBe("confirmed");
  expect(view!.paidCount).toBe(5);
  expect(await audits("registration.confirmed", registrationId)).toHaveLength(1);
});

test("subs don't need to pay but a paid sub counts toward 5", async () => {
  const tournament = await openTournament({ maxSubs: 1 });
  const a = await registered(tournament.id, "a", 6);
  const b = await registered(tournament.id, "b", 6);

  // Team A: four starters and the sub paid.
  await markPaid(testDb, admin, tournament.id, [...a.ids.slice(0, 4), a.ids[5]!], "MP");
  expect(await statusOf(a.registrationId)).toBe("confirmed");

  // Team B: the five starters paid, the sub didn't.
  await markPaid(testDb, admin, tournament.id, b.ids.slice(0, 5), "MP");
  expect(await statusOf(b.registrationId)).toBe("confirmed");
  const view = await getRegistrationView(testDb, b.registrationId);
  expect(view!.roster.find((p) => p.isSub)).toMatchObject({ userId: "b6", paid: false });
});

test("free tournaments confirm a full eligible roster without payments", async () => {
  const tournament = await openTournament({ entryFeeArs: 0 });
  const { registrationId } = await registered(tournament.id, "p");
  expect(await statusOf(registrationId)).toBe("confirmed");
  expect((await getRegistrationView(testDb, registrationId))!.paidCount).toBe(0);
});

test("confirmation waits for a full roster", async () => {
  const tournament = await openTournament({ entryFeeArs: 0 });
  const { ids, team, captain } = await squad("p", 5);
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: ids.slice(0, 4), subs: [] });
  await markPaid(testDb, admin, tournament.id, ids.slice(0, 4), "MP");
  expect(await statusOf(registrationId)).toBe("pending");

  // Completing the roster confirms it.
  const deps = { db: testDb, riot: new FakeRiotClient() };
  expect((await updateRoster(deps, captain, registrationId, { starters: ids, subs: [] })).ok).toBe(true);
  expect(await statusOf(registrationId)).toBe("confirmed");
});

test("cap full sends the next qualifying team to the waitlist and promotes it when a slot frees", async () => {
  const tournament = await openTournament({ teamCap: 2 });
  const a = await registered(tournament.id, "a");
  const b = await registered(tournament.id, "b");
  const c = await registered(tournament.id, "c");
  for (const team of [a, b, c]) await markPaid(testDb, admin, tournament.id, team.ids, "MP");

  expect(await statusOf(a.registrationId)).toBe("confirmed");
  expect(await statusOf(b.registrationId)).toBe("confirmed");
  expect(await statusOf(c.registrationId)).toBe("waitlisted");
  expect(await audits("registration.waitlisted", c.registrationId)).toHaveLength(1);

  expect(await withdrawRegistration(testDb, a.captain, a.registrationId)).toEqual({ ok: true });
  expect(await statusOf(c.registrationId)).toBe("confirmed");
  const forfeited = await testDb.select().from(entryPayments).where(eq(entryPayments.tournamentId, tournament.id));
  expect(forfeited.filter((p) => p.forfeited).map((p) => p.userId).sort()).toEqual([...a.ids].sort());
  expect((await getRegistrationView(testDb, a.registrationId))!.paidCount).toBe(0);
  const forfeitAudits = await audits("payment.forfeited");
  expect(forfeitAudits.map((r) => (r.data as { userId: string }).userId).sort()).toEqual([...a.ids].sort());
});

test("a pending team withdrawing forfeits nothing", async () => {
  const tournament = await openTournament();
  const { ids, captain, registrationId } = await registered(tournament.id, "p");
  await markPaid(testDb, admin, tournament.id, ids.slice(0, 3), "MP");
  expect(await statusOf(registrationId)).toBe("pending");

  expect(await withdrawRegistration(testDb, captain, registrationId)).toEqual({ ok: true });
  const payments = await testDb.select().from(entryPayments).where(eq(entryPayments.tournamentId, tournament.id));
  expect(payments).toHaveLength(3);
  expect(payments.every((p) => !p.forfeited)).toBe(true);
  expect(await audits("payment.forfeited")).toHaveLength(0);
});

test("a player can pay again after a forfeit and the audit shows the replacement", async () => {
  const tournament = await openTournament();
  const { ids, captain, registrationId } = await registered(tournament.id, "p");
  await markPaid(testDb, admin, tournament.id, ids, "MP-OLD");
  await withdrawRegistration(testDb, captain, registrationId);

  expect(await markPaid(testDb, admin, tournament.id, [ids[1]!], "MP-NEW")).toEqual({ ok: true, marked: 1 });
  const [payment] = await testDb
    .select()
    .from(entryPayments)
    .where(and(eq(entryPayments.tournamentId, tournament.id), eq(entryPayments.userId, ids[1]!)));
  expect(payment).toMatchObject({ forfeited: false, reference: "MP-NEW" });
  const marked = (await audits("payment.marked", payment!.id)).map((r) => r.data);
  expect(marked).toContainEqual({
    tournamentId: tournament.id,
    userId: ids[1],
    reference: "MP-NEW",
    replacedForfeited: true,
    previousReference: "MP-OLD",
  });
  expect(await audits("payment.forfeited", payment!.id)).toHaveLength(1);
});

test("two payment marks racing for the last slot never exceed the cap", async () => {
  const tournament = await openTournament({ teamCap: 1 });
  const a = await registered(tournament.id, "a");
  const b = await registered(tournament.id, "b");
  await markPaid(testDb, admin, tournament.id, [...a.ids.slice(0, 4), ...b.ids.slice(0, 4)], "MP");

  await Promise.all([
    markPaid(testDb, admin, tournament.id, [a.ids[4]!], "MP-A"),
    markPaid(testDb, admin, tournament.id, [b.ids[4]!], "MP-B"),
  ]);
  const statuses = [await statusOf(a.registrationId), await statusOf(b.registrationId)].sort();
  expect(statuses).toEqual(["confirmed", "waitlisted"]);
});

test("an eligibility exception lets an ineligible roster qualify", async () => {
  const tournament = await openTournament({
    entryFeeArs: 0,
    eligibilityRules: [{ id: "cap", type: "player_rank_range", max: { tier: "EMERALD", division: "I" } }],
  });
  const ids = [await linkedPlayer("p1", DIA1)];
  for (let i = 2; i <= 5; i++) ids.push(await linkedPlayer(`p${i}`, PLAT2));
  const team = await createTestTeam("p1", ids.slice(1));

  expect(
    await grantEligibilityException(testDb, admin, { tournamentId: tournament.id, teamId: team.id, ruleId: "cap", reason: "Smurf verificado" }),
  ).toEqual({ ok: true });
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: ids, subs: [] });
  expect(await statusOf(registrationId)).toBe("confirmed");
  expect(await audits("eligibility.exception_granted")).toHaveLength(1);

  // Revoking it before close unconfirms the team.
  expect(await revokeEligibilityException(testDb, admin, { tournamentId: tournament.id, teamId: team.id, ruleId: "cap" })).toEqual({
    ok: true,
  });
  expect(await statusOf(registrationId)).toBe("pending");
  expect(await audits("eligibility.exception_revoked")).toHaveLength(1);
  expect(await audits("registration.unconfirmed", registrationId)).toHaveLength(1);
});

test("lowering teamCap via updateTournament waitlists the most recently qualified team", async () => {
  const tournament = await openTournament({ teamCap: 2, entryFeeArs: 0 });
  const a = await registered(tournament.id, "a");
  const b = await registered(tournament.id, "b");
  expect([await statusOf(a.registrationId), await statusOf(b.registrationId)]).toEqual(["confirmed", "confirmed"]);

  expect(await updateTournament(testDb, admin, tournament.id, inputOf(tournament, { teamCap: 1 }))).toEqual({ ok: true });
  expect(await statusOf(a.registrationId)).toBe("confirmed");
  expect(await statusOf(b.registrationId)).toBe("waitlisted");
});

test("a confirmed roster change that would unconfirm is rejected", async () => {
  const tournament = await openTournament({ maxSubs: 1 });
  const { ids, captain, registrationId } = await registered(tournament.id, "p", 6);
  await markPaid(testDb, admin, tournament.id, ids.slice(0, 5), "MP");
  expect(await statusOf(registrationId)).toBe("confirmed");

  // Swapping a paid starter for the unpaid sub leaves only 4 paid players.
  const deps = { db: testDb, riot: new FakeRiotClient() };
  expect(
    await updateRoster(deps, captain, registrationId, { starters: [...ids.slice(0, 4), ids[5]!], subs: [] }),
  ).toEqual({ ok: false, reason: "would_unconfirm" });
  // Swapping roles keeps 5 paid players, so it's allowed.
  expect(
    (await updateRoster(deps, captain, registrationId, { starters: [...ids.slice(0, 4), ids[5]!], subs: [ids[4]!] })).ok,
  ).toBe(true);
  expect(await statusOf(registrationId)).toBe("confirmed");
});

test("unmarking a payment unconfirms the team", async () => {
  const tournament = await openTournament();
  const { ids, registrationId } = await registered(tournament.id, "p");
  await markPaid(testDb, admin, tournament.id, ids, "MP");
  expect(await statusOf(registrationId)).toBe("confirmed");

  expect(await unmarkPaid(testDb, admin, tournament.id, ids[2]!)).toEqual({ ok: true });
  expect(await statusOf(registrationId)).toBe("pending");
  expect(await audits("payment.unmarked")).toHaveLength(1);
  expect(await audits("registration.unconfirmed", registrationId)).toHaveLength(1);
  expect(await unmarkPaid(testDb, admin, tournament.id, ids[2]!)).toEqual({ ok: false, reason: "not_paid" });
});

test("force removing a registration drops it and frees its slot", async () => {
  const tournament = await openTournament({ teamCap: 1, entryFeeArs: 0 });
  const a = await registered(tournament.id, "a");
  const b = await registered(tournament.id, "b");
  expect(await statusOf(b.registrationId)).toBe("waitlisted");

  expect(await forceRemoveRegistration(testDb, admin, a.registrationId, "Conducta")).toEqual({ ok: true });
  expect(await statusOf(a.registrationId)).toBe("dropped");
  const rows = await testDb.select().from(registrationPlayers).where(eq(registrationPlayers.registrationId, a.registrationId));
  expect(rows.every((r) => !r.active)).toBe(true);
  expect(await statusOf(b.registrationId)).toBe("confirmed");
  expect(await audits("registration.force_removed", a.registrationId)).toHaveLength(1);
  expect(await forceRemoveRegistration(testDb, admin, crypto.randomUUID(), "x")).toEqual({ ok: false, reason: "not_found" });
});

test("a player leaving a waitlisted roster sends it back to pending", async () => {
  const tournament = await openTournament({ teamCap: 1, entryFeeArs: 0 });
  await registered(tournament.id, "a");
  const b = await registered(tournament.id, "b");
  expect(await statusOf(b.registrationId)).toBe("waitlisted");

  expect(await leaveTeam(testDb, "b2", b.team.id)).toEqual({ ok: true });
  expect(await statusOf(b.registrationId)).toBe("pending");
});
