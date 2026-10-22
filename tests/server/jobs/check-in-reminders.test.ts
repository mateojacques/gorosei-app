import { beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { checkIns, notifications, registrationPlayers, tournaments } from "../../../src/server/db/schema";
import { sendCheckInReminders } from "../../../src/server/jobs/check-in-reminders";
import { CHECK_IN_REMINDER_BEFORE_CLOSE_MINUTES, checkInWindow } from "../../../src/shared/check-in";
import { checkedInTestTeam, createTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

const MINUTE = 60_000;

async function field() {
  const tournament = await createTestTournament({ status: "registration_open", entryFeeArs: 0 });
  const short = await checkedInTestTeam(tournament, "a", 4);
  const full = await checkedInTestTeam(tournament, "b", 5);
  await testDb.update(tournaments).set({ status: "check_in" }).where(eq(tournaments.id, tournament.id));
  const closesAt = checkInWindow(tournament.startsAt).closesAt;
  return { tournament, short, full, at: (minutesBefore: number) => new Date(closesAt.getTime() - minutesBefore * MINUTE) };
}

const reminders = () => testDb.select().from(notifications).where(eq(notifications.kind, "check_in_reminder"));

test("the reminder window is 15 minutes", () => {
  expect(CHECK_IN_REMINDER_BEFORE_CLOSE_MINUTES).toBe(15);
});

test("nothing before the window", async () => {
  const { at } = await field();
  expect(await sendCheckInReminders(testDb, at(16))).toEqual({ reminded: 0 });
  expect(await reminders()).toHaveLength(0);
});

test("the captain of a team missing players is reminded once; a full team is not", async () => {
  const { tournament, short, at } = await field();
  expect(await sendCheckInReminders(testDb, at(15))).toEqual({ reminded: 1 });
  const [note] = await reminders();
  expect(note).toMatchObject({
    userId: short.captain,
    payload: {
      kind: "check_in_reminder",
      missing: 1,
      closesAt: checkInWindow(tournament.startsAt).closesAt.toISOString(),
      tournament: { slug: tournament.slug },
    },
  });
  expect(await sendCheckInReminders(testDb, at(5))).toEqual({ reminded: 0 });
});

test("a swapped-out player's check-in does not count", async () => {
  const { full, at } = await field();
  await testDb
    .update(registrationPlayers)
    .set({ active: false })
    .where(and(eq(registrationPlayers.registrationId, full.registrationId), eq(registrationPlayers.userId, full.ids[1]!)));
  await sendCheckInReminders(testDb, at(10));
  expect((await reminders()).map((n) => n.userId).sort()).toEqual([full.captain, "a1"].sort());
  const fullNote = (await reminders()).find((n) => n.userId === full.captain)!;
  expect(fullNote.payload).toMatchObject({ missing: 1 });
  expect(await testDb.select().from(checkIns).where(eq(checkIns.userId, full.ids[1]!))).toHaveLength(1);
});

test("nothing once check-in has closed", async () => {
  const { at } = await field();
  expect(await sendCheckInReminders(testDb, at(0))).toEqual({ reminded: 0 });
});
