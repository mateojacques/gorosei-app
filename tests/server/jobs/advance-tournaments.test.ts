import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { tournaments } from "../../../src/server/db/schema";
import { advanceTournaments } from "../../../src/server/jobs/advance-tournaments";
import { checkedInTestTeam, createTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

const statusOf = async (id: string) =>
  (await testDb.select({ s: tournaments.status }).from(tournaments).where(eq(tournaments.id, id)))[0]!.s;

test("opens a due check-in and closes a due one in the same pass, leaving others alone", async () => {
  const toOpen = await createTestTournament({ status: "registration_closed", startsAt: new Date("2026-11-01T20:00:00Z") });
  const later = await createTestTournament({ status: "registration_closed", startsAt: new Date("2026-11-03T20:00:00Z") });
  const toClose = await createTestTournament({ status: "registration_open", entryFeeArs: 0, startsAt: new Date("2026-11-01T19:20:00Z"), registrationClosesAt: new Date("2026-11-01T18:00:00Z") });
  await checkedInTestTeam(toClose, "x", 5);
  await checkedInTestTeam(toClose, "y", 5);
  await testDb.update(tournaments).set({ status: "check_in" }).where(eq(tournaments.id, toClose.id));

  const now = new Date("2026-11-01T19:30:00Z");
  expect(await advanceTournaments(testDb, now)).toEqual({ opened: 1, closed: 1 });
  expect(await statusOf(toOpen.id)).toBe("check_in");
  expect(await statusOf(later.id)).toBe("registration_closed");
  expect(await statusOf(toClose.id)).toBe("live");
  expect(await advanceTournaments(testDb, now)).toEqual({ opened: 0, closed: 0 });
});
