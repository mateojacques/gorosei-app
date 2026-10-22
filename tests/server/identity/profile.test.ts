import { beforeEach, expect, test } from "bun:test";
import { rankSnapshots } from "../../../src/server/db/schema";
import { getPublicProfile } from "../../../src/server/identity/profile";
import { createTestRiotAccount, resetTestDb, testDb } from "../../helpers/db";

let accountId: string;

beforeEach(async () => {
  await resetTestDb();
  accountId = await createTestRiotAccount("u1", { puuid: "p1", gameName: "Señor Café", tagLine: "LAS" });
});

test("finds a player case-insensitively, accents included", async () => {
  await testDb.insert(rankSnapshots).values({
    riotAccountId: accountId,
    tier: "DIAMOND",
    division: "I",
    lp: 10,
    wins: 1,
    losses: 1,
    observedAt: new Date(),
  });

  const profile = await getPublicProfile(testDb, "SEÑOR CAFÉ", "las");

  expect(profile).toEqual({
    gameName: "Señor Café",
    tagLine: "LAS",
    profileIconId: 0,
    summonerLevel: 30,
    currentRank: { tier: "DIAMOND", division: "I", lp: 10 },
    seasonPeak: { tier: "DIAMOND", division: "I", lp: 10 },
    teams: [],
    tournaments: [],
  });
});

test("an unranked player has null ranks", async () => {
  const profile = await getPublicProfile(testDb, "señor café", "LAS");
  expect(profile).toMatchObject({ currentRank: null, seasonPeak: null });
});

test("an unknown player is null", async () => {
  expect(await getPublicProfile(testDb, "Nadie", "LAS")).toBeNull();
});

test("lists the player's teams and confirmed tournament registrations", async () => {
  const { createTestRegistration, createTestTeam, createTestTournament, linkedPlayer } = await import("../../helpers/competition");
  const { registrations } = await import("../../../src/server/db/schema");
  const mates = await Promise.all(["m1", "m2", "m3", "m4"].map((id) => linkedPlayer(id)));
  const team = await createTestTeam("u1", mates, "Los Pibes");
  const tournament = await createTestTournament({ title: "Copa Semanal LAS", edition: 3, status: "registration_open", entryFeeArs: 0 });
  await createTestRegistration(tournament.id, team.id, { starters: ["u1", ...mates], subs: [] });
  // A second, unconfirmed registration elsewhere is not a tournament the player has played.
  const other = await createTestTournament({ title: "Copa Otra", status: "registration_open" });
  await createTestRegistration(other.id, team.id, { starters: ["u1"], subs: [] });
  expect((await testDb.select().from(registrations)).map((r) => r.status).sort()).toEqual(["confirmed", "pending"]);

  const profile = await getPublicProfile(testDb, "Señor Café", "LAS");

  expect(profile?.teams).toEqual([{ name: "Los Pibes", tag: expect.any(String), slug: team.slug }]);
  expect(profile?.tournaments).toEqual([
    {
      title: "Copa Semanal LAS",
      edition: 3,
      slug: tournament.slug,
      startsAt: tournament.startsAt,
      teamName: "Los Pibes",
      teamSlug: team.slug,
      status: "registration_open",
      placement: null,
    },
  ]);
});

test("shows the placement of finished tournaments and none for running ones", async () => {
  const { createTestRegistration, createTestTeam, createTestTournament, linkedPlayer } = await import("../../helpers/competition");
  const { brackets, registrations, tournaments } = await import("../../../src/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const mates = await Promise.all(["m1", "m2", "m3", "m4"].map((id) => linkedPlayer(id)));
  const team = await createTestTeam("u1", mates, "Los Pibes");
  const won = await createTestTournament({ status: "registration_open", entryFeeArs: 0, startsAt: new Date("2026-11-01T20:00:00Z") });
  const live = await createTestTournament({ status: "registration_open", entryFeeArs: 0, startsAt: new Date("2026-11-08T20:00:00Z"), registrationClosesAt: new Date("2026-11-07T20:00:00Z") });
  const wonReg = await createTestRegistration(won.id, team.id, { starters: ["u1", ...mates], subs: [] });
  await createTestRegistration(live.id, team.id, { starters: ["u1", ...mates], subs: [] });
  await testDb.update(tournaments).set({ status: "finished" }).where(eq(tournaments.id, won.id));
  await testDb.update(tournaments).set({ status: "live" }).where(eq(tournaments.id, live.id));
  await testDb.insert(brackets).values({ tournamentId: won.id, data: {} as never, stageId: 0, finalStandings: [{ registrationId: wonReg, rank: 1 }] });
  // A withdrawn registration stays out.
  const gone = await createTestTournament({ status: "registration_open", entryFeeArs: 0 });
  const goneReg = await createTestRegistration(gone.id, team.id, { starters: ["u1", ...mates], subs: [] });
  await testDb.update(registrations).set({ status: "withdrawn" }).where(eq(registrations.id, goneReg));

  const profile = await getPublicProfile(testDb, "Señor Café", "LAS");
  expect(profile!.tournaments.map((t) => [t.slug, t.status, t.placement])).toEqual([
    [live.slug, "live", null],
    [won.slug, "finished", 1],
  ]);
});
