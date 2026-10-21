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
