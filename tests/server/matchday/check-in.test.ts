import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, registrations, tournaments } from "../../../src/server/db/schema";
import { checkIn, decideShortHanded, getCheckInView } from "../../../src/server/matchday/check-in";
import { confirmedTestTeam, createTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

const OPEN = new Date("2026-11-01T19:30:00Z");

beforeEach(resetTestDb);

async function setup() {
  const tournament = await createTestTournament({ status: "registration_open", entryFeeArs: 0 });
  const team = await confirmedTestTeam(tournament.id, "a");
  await testDb.update(tournaments).set({ status: "check_in" }).where(eq(tournaments.id, tournament.id));
  return { tournament, team };
}

test("a rostered player checks in; checking in twice is a no-op", async () => {
  const { team } = await setup();
  expect(await checkIn(testDb, team.ids[1]!, team.registrationId, OPEN)).toEqual({ ok: true });
  expect(await checkIn(testDb, team.ids[1]!, team.registrationId, OPEN)).toEqual({ ok: true });
  const view = await getCheckInView(testDb, team.registrationId, OPEN);
  expect(view?.checkedInCount).toBe(1);
  const audits = await testDb.select().from(auditLog).where(eq(auditLog.action, "checkin.checked_in"));
  expect(audits.length).toBe(1);
});

test("a sub counts toward the checked-in count", async () => {
  const { team } = await setup();
  await checkIn(testDb, team.sub, team.registrationId, OPEN);
  const view = await getCheckInView(testDb, team.registrationId, OPEN);
  expect(view?.checkedInCount).toBe(1);
  expect(view?.players.find((p) => p.userId === team.sub)).toMatchObject({ isSub: true, checkedIn: true });
});

test("rejects a player who is not on the roster", async () => {
  const { team } = await setup();
  const outsider = await createTestUser("outsider");
  expect(await checkIn(testDb, outsider, team.registrationId, OPEN)).toEqual({ ok: false, reason: "not_on_roster" });
});

test("rejects before check_in status and outside the window", async () => {
  const { tournament, team } = await setup();
  expect(await checkIn(testDb, team.ids[0]!, team.registrationId, new Date("2026-11-01T18:59:00Z"))).toEqual({
    ok: false,
    reason: "not_open",
  });
  expect(await checkIn(testDb, team.ids[0]!, team.registrationId, new Date("2026-11-01T19:51:00Z"))).toEqual({
    ok: false,
    reason: "not_open",
  });
  await testDb.update(tournaments).set({ status: "registration_closed" }).where(eq(tournaments.id, tournament.id));
  expect(await checkIn(testDb, team.ids[0]!, team.registrationId, OPEN)).toEqual({ ok: false, reason: "not_open" });
});

test("rejects a withdrawn or forfeited registration", async () => {
  const { team } = await setup();
  for (const status of ["withdrawn", "forfeited"] as const) {
    await testDb.update(registrations).set({ status }).where(eq(registrations.id, team.registrationId));
    expect(await checkIn(testDb, team.ids[0]!, team.registrationId, OPEN)).toEqual({ ok: false, reason: "registration_inactive" });
  }
});

test("only the captain decides, and the decision can change while open", async () => {
  const { team } = await setup();
  expect(await decideShortHanded(testDb, team.ids[1]!, team.registrationId, "play", OPEN)).toEqual({ ok: false, reason: "not_captain" });
  expect(await decideShortHanded(testDb, team.captain, team.registrationId, "play", OPEN)).toEqual({ ok: true });
  expect((await getCheckInView(testDb, team.registrationId, OPEN))?.decision).toBe("play");
  expect(await decideShortHanded(testDb, team.captain, team.registrationId, "withdraw", OPEN)).toEqual({ ok: true });
  expect((await getCheckInView(testDb, team.registrationId, OPEN))?.decision).toBe("withdraw");
  expect(await decideShortHanded(testDb, team.captain, team.registrationId, "play", new Date("2026-11-01T19:55:00Z"))).toEqual({
    ok: false,
    reason: "not_open",
  });
});

test("the view's outcome follows the checked-in count", async () => {
  const { team } = await setup();
  const outcome = async () => (await getCheckInView(testDb, team.registrationId, OPEN))?.outcome;
  expect(await outcome()).toBe("forfeit");
  await checkIn(testDb, team.ids[0]!, team.registrationId, OPEN);
  await checkIn(testDb, team.ids[1]!, team.registrationId, OPEN);
  await checkIn(testDb, team.ids[2]!, team.registrationId, OPEN);
  expect(await outcome()).toBe("short_handed");
  await checkIn(testDb, team.ids[3]!, team.registrationId, OPEN);
  await checkIn(testDb, team.ids[4]!, team.registrationId, OPEN);
  expect(await outcome()).toBe("in");
});
