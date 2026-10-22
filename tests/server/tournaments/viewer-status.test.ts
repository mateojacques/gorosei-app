import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { registrations } from "../../../src/server/db/schema";
import { getViewerTournamentStatus } from "../../../src/server/tournaments/viewer-status";
import {
  checkedInTestTeam,
  createTestRegistration,
  createTestTeam,
  createTestTournament,
  linkedPlayer,
  payFor,
  poolPlayer,
} from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

test("a player on a partial, partly paid roster", async () => {
  const t = await createTestTournament({ status: "registration_open", entryFeeArs: 5000 });
  const ids = await Promise.all(["a1", "a2", "a3", "a4"].map((id) => linkedPlayer(id)));
  const team = await createTestTeam(ids[0]!, ids.slice(1), "Los Cuatro");
  await createTestRegistration(t.id, team.id, { starters: ids, subs: [] });
  for (const id of ids.slice(0, 3)) await payFor(t.id, id);
  // Another team's payments never count for this one.
  const others = await Promise.all(["b1", "b2"].map((id) => linkedPlayer(id)));
  const otherTeam = await createTestTeam(others[0]!, others.slice(1), "Los Otros");
  await createTestRegistration(t.id, otherTeam.id, { starters: others, subs: [] });
  for (const id of others) await payFor(t.id, id);

  expect(await getViewerTournamentStatus(testDb, "a2", t.id)).toEqual({
    riotLinked: true,
    inPool: false,
    registration: { registrationId: expect.any(String), teamName: "Los Cuatro", teamSlug: team.slug, starters: 4, paid: 3, status: "pending" },
    checkedIn: false,
  });
});

test("a withdrawn registration is ignored", async () => {
  const t = await createTestTournament({ status: "registration_open", entryFeeArs: 0 });
  const ids = await Promise.all(["w1", "w2", "w3", "w4", "w5"].map((id) => linkedPlayer(id)));
  const team = await createTestTeam(ids[0]!, ids.slice(1));
  const reg = await createTestRegistration(t.id, team.id, { starters: ids, subs: [] });
  await testDb.update(registrations).set({ status: "withdrawn" }).where(eq(registrations.id, reg));
  expect((await getViewerTournamentStatus(testDb, "w1", t.id)).registration).toBeNull();
});

test("a pool-only player", async () => {
  const t = await createTestTournament({ status: "registration_open" });
  await poolPlayer(t, "pool1");
  expect(await getViewerTournamentStatus(testDb, "pool1", t.id)).toEqual({ riotLinked: true, inPool: true, registration: null, checkedIn: false });
});

test("a checked-in player", async () => {
  const t = await createTestTournament({ status: "registration_open", entryFeeArs: 0 });
  const team = await checkedInTestTeam(t, "c", 5);
  const status = await getViewerTournamentStatus(testDb, team.captain, t.id);
  expect(status.checkedIn).toBe(true);
  expect(status.registration).toMatchObject({ starters: 5, status: "confirmed" });
  expect((await getViewerTournamentStatus(testDb, team.sub, t.id)).checkedIn).toBe(false);
});

test("a user without a Riot account", async () => {
  const t = await createTestTournament({ status: "registration_open" });
  await createTestUser("nobody");
  expect(await getViewerTournamentStatus(testDb, "nobody", t.id)).toEqual({ riotLinked: false, inPool: false, registration: null, checkedIn: false });
});
