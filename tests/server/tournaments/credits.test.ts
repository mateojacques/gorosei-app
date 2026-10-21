import { beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { auditLog, entryCredits, entryPayments, registrationPlayers, registrations, tournaments } from "../../../src/server/db/schema";
import { markPaid, unmarkPaid } from "../../../src/server/tournaments/confirmations";
import {
  applyCredit,
  cancelTournament,
  closeRegistration,
  grantManualCredit,
  listCreditsForUser,
  revokeCredit,
} from "../../../src/server/tournaments/credits";
import { withdrawRegistration } from "../../../src/server/tournaments/registrations";
import type { Rank } from "../../../src/shared/rank";
import { createTestRegistration, createTestTeam, createTestTournament, linkedPlayer } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

const PLAT2: Rank = { tier: "PLATINUM", division: "II", lp: 40 };
const NOW = new Date("2026-10-30T20:00:00Z");

let admin: string;

beforeEach(async () => {
  await resetTestDb();
  admin = await createTestUser("admin");
});

/** A team of five linked players `${prefix}1..5`, registered with all five as starters. */
async function registered(tournamentId: string, prefix: string) {
  const ids: string[] = [];
  for (let i = 1; i <= 5; i++) ids.push(await linkedPlayer(`${prefix}${i}`, PLAT2));
  const team = await createTestTeam(ids[0]!, ids.slice(1));
  const registrationId = await createTestRegistration(tournamentId, team.id, { starters: ids, subs: [] });
  return { ids, captain: ids[0]!, registrationId };
}

const openTournament = (overrides: Parameters<typeof createTestTournament>[0] = {}) =>
  createTestTournament({ status: "registration_open", ...overrides });

async function statusOf(registrationId: string) {
  const [row] = await testDb.select({ status: registrations.status }).from(registrations).where(eq(registrations.id, registrationId));
  return row!.status;
}

const creditsFrom = (tournamentId: string) =>
  testDb.select().from(entryCredits).where(eq(entryCredits.sourceTournamentId, tournamentId));

const audits = (action: string) => testDb.select().from(auditLog).where(eq(auditLog.action, action));

test("closing drops unconfirmed teams and credits their paid players", async () => {
  const tournament = await openTournament();
  const a = await registered(tournament.id, "a");
  const b = await registered(tournament.id, "b");
  await markPaid(testDb, admin, tournament.id, a.ids, "MP");
  await markPaid(testDb, admin, tournament.id, b.ids.slice(0, 3), "MP");
  expect(await statusOf(a.registrationId)).toBe("confirmed");

  expect(await closeRegistration(testDb, tournament.id, NOW, null)).toEqual({ ok: true, dropped: 1, credited: 3 });
  const [closed] = await testDb.select().from(tournaments).where(eq(tournaments.id, tournament.id));
  expect(closed!.status).toBe("registration_closed");
  expect(await statusOf(a.registrationId)).toBe("confirmed");
  expect(await statusOf(b.registrationId)).toBe("dropped");
  const rows = await testDb.select().from(registrationPlayers).where(eq(registrationPlayers.registrationId, b.registrationId));
  expect(rows.every((r) => !r.active)).toBe(true);

  const credits = await creditsFrom(tournament.id);
  expect(credits.map((c) => c.userId).sort()).toEqual(b.ids.slice(0, 3).sort());
  expect(credits.every((c) => c.reason === "unconfirmed" && c.status === "available")).toBe(true);
  expect(await audits("credit.granted")).toHaveLength(3);
  expect(await audits("tournament.registration_closed")).toHaveLength(1);
  expect(await audits("registration.dropped")).toHaveLength(1);
});

test("waitlisted teams are dropped with waitlisted credits", async () => {
  const tournament = await openTournament({ teamCap: 2 });
  const teams = [await registered(tournament.id, "a"), await registered(tournament.id, "b"), await registered(tournament.id, "c")];
  for (const team of teams) await markPaid(testDb, admin, tournament.id, team.ids, "MP");
  const c = teams[2]!;
  expect(await statusOf(c.registrationId)).toBe("waitlisted");

  expect(await closeRegistration(testDb, tournament.id, NOW, null)).toEqual({ ok: true, dropped: 1, credited: 5 });
  expect(await statusOf(c.registrationId)).toBe("dropped");
  const credits = await creditsFrom(tournament.id);
  expect(credits.map((r) => r.userId).sort()).toEqual([...c.ids].sort());
  expect(credits.every((r) => r.reason === "waitlisted")).toBe(true);
});

test("a confirmed team that withdrew gets no credit at close", async () => {
  const tournament = await openTournament();
  const a = await registered(tournament.id, "a");
  await markPaid(testDb, admin, tournament.id, a.ids, "MP");
  expect(await withdrawRegistration(testDb, a.captain, a.registrationId)).toEqual({ ok: true });

  expect(await closeRegistration(testDb, tournament.id, NOW, null)).toEqual({ ok: true, dropped: 0, credited: 0 });
  expect(await creditsFrom(tournament.id)).toHaveLength(0);
});

test("closing twice is a no-op", async () => {
  const tournament = await openTournament();
  const b = await registered(tournament.id, "b");
  await markPaid(testDb, admin, tournament.id, b.ids.slice(0, 2), "MP");

  expect(await closeRegistration(testDb, tournament.id, NOW, null)).toEqual({ ok: true, dropped: 1, credited: 2 });
  expect(await closeRegistration(testDb, tournament.id, NOW, null)).toEqual({ ok: false, reason: "invalid_state" });
  expect(await creditsFrom(tournament.id)).toHaveLength(2);
  expect(await audits("tournament.registration_closed")).toHaveLength(1);
});

test("closing at the same time from two places credits each player once", async () => {
  const tournament = await openTournament();
  const b = await registered(tournament.id, "b");
  await markPaid(testDb, admin, tournament.id, b.ids.slice(0, 2), "MP");

  const results = await Promise.all([
    closeRegistration(testDb, tournament.id, NOW, null),
    closeRegistration(testDb, tournament.id, NOW, null),
  ]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(await creditsFrom(tournament.id)).toHaveLength(2);
});

test("cancelling credits every paid player once, even after close", async () => {
  const tournament = await openTournament();
  const a = await registered(tournament.id, "a");
  const b = await registered(tournament.id, "b");
  await markPaid(testDb, admin, tournament.id, a.ids, "MP");
  await markPaid(testDb, admin, tournament.id, b.ids.slice(0, 3), "MP");
  await closeRegistration(testDb, tournament.id, NOW, null);

  expect(await cancelTournament(testDb, admin, tournament.id, "Caída del servidor")).toEqual({ ok: true, credited: 5 });
  const credits = await creditsFrom(tournament.id);
  expect(credits).toHaveLength(8);
  const reasonOf = (userId: string) => credits.find((c) => c.userId === userId)!.reason;
  expect(a.ids.map(reasonOf)).toEqual(Array(5).fill("cancelled"));
  expect(b.ids.slice(0, 3).map(reasonOf)).toEqual(Array(3).fill("unconfirmed"));
  expect(await audits("tournament.cancelled")).toHaveLength(1);
  expect(await audits("credit.granted")).toHaveLength(8);

  expect(await cancelTournament(testDb, admin, tournament.id, "otra vez")).toEqual({ ok: false, reason: "invalid_state" });
});

test("applying a credit pays the player and marks the credit used", async () => {
  const source = await openTournament();
  const s = await registered(source.id, "s");
  await markPaid(testDb, admin, source.id, s.ids.slice(0, 1), "MP");
  await closeRegistration(testDb, source.id, NOW, null);
  const [credit] = await listCreditsForUser(testDb, s.ids[0]!);
  expect(credit).toMatchObject({ reason: "unconfirmed", status: "available" });

  const target = await openTournament();
  const t = await registered(target.id, "t");
  expect(await applyCredit(testDb, admin, credit!.id, target.id)).toEqual({ ok: true });
  const [payment] = await testDb
    .select()
    .from(entryPayments)
    .where(and(eq(entryPayments.tournamentId, target.id), eq(entryPayments.userId, s.ids[0]!)));
  expect(payment).toMatchObject({ source: "credit", creditId: credit!.id, forfeited: false });
  const [used] = await listCreditsForUser(testDb, s.ids[0]!);
  expect(used).toMatchObject({ status: "used", usedPaymentId: payment!.id });
  expect(await audits("credit.used")).toHaveLength(1);

  expect(await applyCredit(testDb, admin, credit!.id, target.id)).toEqual({ ok: false, reason: "credit_unavailable" });

  // Unmarking the credit payment returns the credit.
  expect(await unmarkPaid(testDb, admin, target.id, s.ids[0]!)).toEqual({ ok: true });
  const [restored] = await listCreditsForUser(testDb, s.ids[0]!);
  expect(restored).toMatchObject({ status: "available", usedPaymentId: null });
  expect(await audits("credit.restored")).toHaveLength(1);

  // A credit counts toward confirmation like any payment.
  await markPaid(testDb, admin, target.id, t.ids.slice(0, 4), "MP");
  const manual = await grantManualCredit(testDb, admin, t.ids[4]!, "Compensación");
  expect(await applyCredit(testDb, admin, manual.creditId, target.id)).toEqual({ ok: true });
  expect(await statusOf(t.registrationId)).toBe("confirmed");
});

test("a credit can't pay a player who already paid, or a tournament that isn't taking payments", async () => {
  const tournament = await openTournament();
  const { ids } = await registered(tournament.id, "p");
  await markPaid(testDb, admin, tournament.id, [ids[0]!], "MP");
  const credit = await grantManualCredit(testDb, admin, ids[0]!, "Compensación");
  expect(await applyCredit(testDb, admin, credit.creditId, tournament.id)).toEqual({ ok: false, reason: "already_paid" });

  const draft = await createTestTournament();
  expect(await applyCredit(testDb, admin, credit.creditId, draft.id)).toEqual({ ok: false, reason: "invalid_state" });
  expect(await applyCredit(testDb, admin, crypto.randomUUID(), tournament.id)).toEqual({
    ok: false,
    reason: "credit_unavailable",
  });
});

test("manual credits can be granted and revoked", async () => {
  const player = await linkedPlayer("p1", PLAT2);
  const first = await grantManualCredit(testDb, admin, player, "Compensación");
  const second = await grantManualCredit(testDb, admin, player, "Otra compensación");
  expect(first.creditId).not.toBe(second.creditId);
  expect((await listCreditsForUser(testDb, player)).map((c) => c.reason)).toEqual(["manual", "manual"]);

  expect(await revokeCredit(testDb, admin, first.creditId)).toEqual({ ok: true });
  expect(await revokeCredit(testDb, admin, first.creditId)).toEqual({ ok: false, reason: "credit_unavailable" });
  const tournament = await openTournament();
  expect(await applyCredit(testDb, admin, first.creditId, tournament.id)).toEqual({ ok: false, reason: "credit_unavailable" });
  expect(await audits("credit.granted")).toHaveLength(2);
  expect(await audits("credit.revoked")).toHaveLength(1);
});

const creditOf = async (userId: string, sourceTournamentId: string) => {
  const [row] = await testDb
    .select()
    .from(entryCredits)
    .where(and(eq(entryCredits.userId, userId), eq(entryCredits.sourceTournamentId, sourceTournamentId)));
  return row!;
};

test("unmarking a payment after close revokes the credit it became", async () => {
  const tournament = await openTournament();
  const b = await registered(tournament.id, "b");
  await markPaid(testDb, admin, tournament.id, [b.ids[0]!], "MP");
  await closeRegistration(testDb, tournament.id, NOW, null);

  expect(await unmarkPaid(testDb, admin, tournament.id, b.ids[0]!)).toEqual({ ok: true });
  expect((await creditOf(b.ids[0]!, tournament.id)).status).toBe("revoked");
  const revoked = await audits("credit.revoked");
  expect(revoked).toHaveLength(1);
  expect(revoked[0]!.data).toMatchObject({ userId: b.ids[0], tournamentId: tournament.id, reason: "payment_unmarked" });
});

test("unmarking a credit payment after close leaves exactly one available credit", async () => {
  const tournament = await openTournament();
  const b = await registered(tournament.id, "b");
  const earlier = await grantManualCredit(testDb, admin, b.ids[0]!, "Compensación");
  expect(await applyCredit(testDb, admin, earlier.creditId, tournament.id)).toEqual({ ok: true });
  await closeRegistration(testDb, tournament.id, NOW, null);

  expect(await unmarkPaid(testDb, admin, tournament.id, b.ids[0]!)).toEqual({ ok: true });
  const credits = await listCreditsForUser(testDb, b.ids[0]!);
  expect(credits.find((c) => c.id === earlier.creditId)!.status).toBe("available");
  expect((await creditOf(b.ids[0]!, tournament.id)).status).toBe("revoked");
  expect(credits.filter((c) => c.status === "available")).toHaveLength(1);
});

test("unmarking after close is refused once the credit was spent", async () => {
  const tournament = await openTournament();
  const b = await registered(tournament.id, "b");
  await markPaid(testDb, admin, tournament.id, [b.ids[0]!], "MP");
  await closeRegistration(testDb, tournament.id, NOW, null);
  const credit = await creditOf(b.ids[0]!, tournament.id);
  const other = await openTournament();
  expect(await applyCredit(testDb, admin, credit.id, other.id)).toEqual({ ok: true });

  expect(await unmarkPaid(testDb, admin, tournament.id, b.ids[0]!)).toEqual({ ok: false, reason: "credit_spent" });
  expect((await creditOf(b.ids[0]!, tournament.id)).status).toBe("used");
  const payments = await testDb.select().from(entryPayments).where(eq(entryPayments.tournamentId, tournament.id));
  expect(payments).toHaveLength(1);
  expect(await audits("payment.unmarked")).toHaveLength(0);
});

test("after close, payments and credits only go to players on a confirmed roster", async () => {
  const tournament = await openTournament();
  const a = await registered(tournament.id, "a");
  const b = await registered(tournament.id, "b");
  await markPaid(testDb, admin, tournament.id, a.ids, "MP");
  expect(await statusOf(a.registrationId)).toBe("confirmed");
  await closeRegistration(testDb, tournament.id, NOW, null);

  // b1 was dropped at close: a payment or credit could never count.
  expect(await markPaid(testDb, admin, tournament.id, [b.ids[0]!], "MP")).toEqual({ ok: false, reason: "invalid_state" });
  const credit = await grantManualCredit(testDb, admin, b.ids[0]!, "Compensación");
  expect(await applyCredit(testDb, admin, credit.creditId, tournament.id)).toEqual({ ok: false, reason: "invalid_state" });
  expect((await listCreditsForUser(testDb, b.ids[0]!))[0]!.status).toBe("available");

  // A confirmed player can still be unmarked and marked again; the team stays confirmed.
  expect(await unmarkPaid(testDb, admin, tournament.id, a.ids[0]!)).toEqual({ ok: true });
  expect(await markPaid(testDb, admin, tournament.id, [a.ids[0]!], "MP-2")).toEqual({ ok: true, marked: 1 });
  expect(await statusOf(a.registrationId)).toBe("confirmed");
});

test("cancelling during registration credits a pending team's paid players", async () => {
  const tournament = await openTournament();
  const b = await registered(tournament.id, "b");
  await markPaid(testDb, admin, tournament.id, b.ids.slice(0, 2), "MP");

  expect(await cancelTournament(testDb, admin, tournament.id, "Sin cupo")).toEqual({ ok: true, credited: 2 });
  const credits = await creditsFrom(tournament.id);
  expect(credits.map((c) => c.userId).sort()).toEqual(b.ids.slice(0, 2).sort());
  expect(credits.every((c) => c.reason === "cancelled" && c.status === "available")).toBe(true);
});

test("applying a credit over a forfeited payment records the replacement", async () => {
  const tournament = await openTournament();
  const a = await registered(tournament.id, "a");
  await markPaid(testDb, admin, tournament.id, a.ids, "MP-OLD");
  await withdrawRegistration(testDb, a.captain, a.registrationId);
  const credit = await grantManualCredit(testDb, admin, a.ids[1]!, "Compensación");

  expect(await applyCredit(testDb, admin, credit.creditId, tournament.id)).toEqual({ ok: true });
  const marked = (await audits("payment.marked")).map((r) => r.data as Record<string, unknown>);
  expect(marked.find((d) => d.creditId === credit.creditId)).toMatchObject({
    replacedForfeited: true,
    previousReference: "MP-OLD",
  });
});
