import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { tournaments } from "../../../src/server/db/schema";
import { closeDueRegistrations } from "../../../src/server/jobs/close-registrations";
import { createTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

async function statusOf(id: string) {
  const [row] = await testDb.select({ status: tournaments.status }).from(tournaments).where(eq(tournaments.id, id));
  return row!.status;
}

test("closeDueRegistrations closes only tournaments past their close time", async () => {
  const now = new Date("2026-10-30T20:00:00Z");
  const past = await createTestTournament({ status: "registration_open", registrationClosesAt: now });
  const future = await createTestTournament({
    status: "registration_open",
    registrationClosesAt: new Date("2026-10-30T20:01:00Z"),
  });
  const draft = await createTestTournament({ registrationClosesAt: new Date("2026-10-29T20:00:00Z") });

  expect(await closeDueRegistrations(testDb, now)).toEqual({ closed: 1 });
  expect(await statusOf(past.id)).toBe("registration_closed");
  expect(await statusOf(future.id)).toBe("registration_open");
  expect(await statusOf(draft.id)).toBe("draft");

  expect(await closeDueRegistrations(testDb, now)).toEqual({ closed: 0 });
});
