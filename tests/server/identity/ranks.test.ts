import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, rankSnapshots } from "../../../src/server/db/schema";
import {
  clearRankOverride,
  getCurrentRank,
  getEffectiveRank,
  getSeasonPeak,
  recordRankSnapshot,
  setRankOverride,
} from "../../../src/server/identity/ranks";
import { getSeasonStart, setSeasonStart } from "../../../src/server/settings";
import type { RiotSoloRank } from "../../../src/server/riot/types";
import type { Rank } from "../../../src/shared/rank";
import { createTestRiotAccount, createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

const SEASON_START = new Date("2026-01-08T00:00:00Z");
const DAY = 86_400_000;

let riot: FakeRiotClient;
let clock: Date;
let accountId: string;
const deps = () => ({ db: testDb, riot, now: () => clock });

const rank = (tier: RiotSoloRank["tier"], division: RiotSoloRank["division"], lp = 0): RiotSoloRank => ({
  tier,
  division,
  lp,
  wins: 10,
  losses: 5,
});

async function observe(r: RiotSoloRank | null, at: Date) {
  riot.setRank("p1", r);
  clock = at;
  expect(await recordRankSnapshot(deps(), accountId)).toBe("recorded");
}

beforeEach(async () => {
  await resetTestDb();
  riot = new FakeRiotClient().addAccount({ puuid: "p1", gameName: "Señor Café", tagLine: "LAS" });
  accountId = await createTestRiotAccount("u1", { puuid: "p1", gameName: "Señor Café", tagLine: "LAS" });
  await createTestUser("admin");
  await setSeasonStart(testDb, "admin", SEASON_START);
});

test("current is the latest snapshot and peak is the season maximum", async () => {
  await observe(rank("GOLD", "II"), new Date("2026-03-01T00:00:00Z"));
  await observe(rank("PLATINUM", "IV"), new Date("2026-03-02T00:00:00Z"));
  await observe(rank("GOLD", "I"), new Date("2026-03-03T00:00:00Z"));

  expect(await getCurrentRank(testDb, accountId)).toEqual({ tier: "GOLD", division: "I", lp: 0 });
  expect(await getSeasonPeak(testDb, accountId)).toEqual({ tier: "PLATINUM", division: "IV", lp: 0 });
});

test("snapshots before the season start do not count toward the peak", async () => {
  await observe(rank("DIAMOND", "I"), new Date(SEASON_START.getTime() - DAY));
  await observe(rank("SILVER", "III", 20), new Date(SEASON_START.getTime() + DAY));

  expect(await getSeasonPeak(testDb, accountId)).toEqual({ tier: "SILVER", division: "III", lp: 20 });
});

test("unranked accounts store a null-tier snapshot and have no rank", async () => {
  await observe(null, new Date("2026-03-01T00:00:00Z"));

  const [snapshot] = await testDb.select().from(rankSnapshots);
  expect(snapshot).toMatchObject({ tier: null, division: null, lp: null });
  expect(await getCurrentRank(testDb, accountId)).toBeNull();
  expect(await getSeasonPeak(testDb, accountId)).toBeNull();
});

test("an account with no snapshots has no rank", async () => {
  expect(await getCurrentRank(testDb, accountId)).toBeNull();
  expect(await getSeasonPeak(testDb, accountId)).toBeNull();
});

test("an override beats both sources until it is cleared, and both changes are audited", async () => {
  await observe(rank("GOLD", "II"), new Date("2026-03-01T00:00:00Z"));
  await setRankOverride(testDb, "admin", accountId, { tier: "EMERALD", division: "II" }, "smurf");

  const emerald: Rank = { tier: "EMERALD", division: "II", lp: 0 };
  expect(await getEffectiveRank(testDb, accountId, "current")).toEqual(emerald);
  expect(await getEffectiveRank(testDb, accountId, "peak_season")).toEqual(emerald);

  await clearRankOverride(testDb, "admin", accountId);

  const gold: Rank = { tier: "GOLD", division: "II", lp: 0 };
  expect(await getEffectiveRank(testDb, accountId, "current")).toEqual(gold);
  expect(await getEffectiveRank(testDb, accountId, "peak_season")).toEqual(gold);
  const actions = (await testDb.select().from(auditLog).where(eq(auditLog.entityId, accountId))).map((a) => a.action);
  expect(actions).toEqual(["rank.override_set", "rank.override_cleared"]);
});

test("recordRankSnapshot writes nothing when Riot is unavailable", async () => {
  riot.setUnavailable("p1");
  expect(await recordRankSnapshot(deps(), accountId)).toBe("riot_unavailable");
  expect(await testDb.select().from(rankSnapshots)).toEqual([]);
});

test("season start defaults to January 1st (UTC) of the current year", async () => {
  await resetTestDb();
  expect(await getSeasonStart(testDb)).toEqual(new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1)));
});

test("setSeasonStart is stored and audited", async () => {
  expect(await getSeasonStart(testDb)).toEqual(SEASON_START);
  const audits = await testDb.select().from(auditLog).where(eq(auditLog.action, "settings.season_start_set"));
  expect(audits).toHaveLength(1);
});
