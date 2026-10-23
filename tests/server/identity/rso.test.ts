import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, rankSnapshots, riotAccounts } from "../../../src/server/db/schema";
import { linkRsoAccount, rsoLinkAllowed, rsoUserInfo } from "../../../src/server/identity/rso";
import { createTestRiotAccount, createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

const faker = { puuid: "puuid-faker", gameName: "Faker", tagLine: "LAS" };
let riot: FakeRiotClient;

beforeEach(async () => {
  await resetTestDb();
  riot = new FakeRiotClient().addAccessToken("tok", { ...faker, summonerLevel: 412, profileIconId: 7 });
});

const deps = () => ({ db: testDb, riot });

test("a new Riot account gets a placeholder address that is never emailed", async () => {
  expect(await rsoUserInfo(deps(), "tok")).toEqual({
    id: "puuid-faker",
    name: "Faker#LAS",
    email: "puuid-faker@riot.invalid",
    emailVerified: false,
  });
});

test("a Riot account already linked by icon change signs in to that account", async () => {
  await createTestRiotAccount("a", faker);
  expect(await rsoUserInfo(deps(), "tok")).toMatchObject({ id: "puuid-faker", email: "a@test.local", emailVerified: true });
});

test("Riot failing mid sign-in fails the sign-in", async () => {
  expect(await rsoUserInfo(deps(), "bad-token")).toBeNull();
});

test("rsoLinkAllowed refuses someone else's Riot account and a second account", async () => {
  await createTestRiotAccount("a", faker);
  await createTestRiotAccount("b", { puuid: "puuid-b", gameName: "B", tagLine: "LAS" });
  await createTestUser("c");
  expect(await rsoLinkAllowed(testDb, "b", "puuid-faker")).toBe(false);
  expect(await rsoLinkAllowed(testDb, "b", "puuid-new")).toBe(false);
  expect(await rsoLinkAllowed(testDb, "a", "puuid-faker")).toBe(true);
  expect(await rsoLinkAllowed(testDb, "c", "puuid-new")).toBe(true);
});

test("linking stores the account, a first rank snapshot and the audit row, and is idempotent", async () => {
  await createTestUser("c");
  riot.setRank(faker.puuid, { tier: "CHALLENGER", division: "I", lp: 1200, wins: 300, losses: 100 });
  const first = await linkRsoAccount(deps(), "c", faker.puuid);
  if (!first.ok) throw new Error(first.reason);
  const [account] = await testDb.select().from(riotAccounts).where(eq(riotAccounts.userId, "c"));
  expect(account).toMatchObject({ puuid: "puuid-faker", gameName: "Faker", tagLine: "LAS", summonerLevel: 412, profileIconId: 7 });
  expect(await testDb.select().from(rankSnapshots).where(eq(rankSnapshots.riotAccountId, first.riotAccountId))).toHaveLength(1);
  const [audit] = await testDb.select().from(auditLog).where(eq(auditLog.action, "riot_account.linked"));
  expect(audit).toMatchObject({ actorUserId: "c", entityId: first.riotAccountId, data: { via: "rso" } });

  expect(await linkRsoAccount(deps(), "c", faker.puuid)).toEqual({ ok: true, riotAccountId: first.riotAccountId });
  expect(await testDb.select().from(riotAccounts)).toHaveLength(1);
});

test("a Riot account taken by someone else, even in a race, is refused", async () => {
  await createTestUser("c");
  await createTestRiotAccount("a", faker);
  expect(await linkRsoAccount(deps(), "c", faker.puuid)).toEqual({ ok: false, reason: "taken_by_other" });

  await resetTestDb();
  await createTestUser("c");
  await createTestUser("racer");
  const racing = Object.assign(Object.create(riot), {
    getSummonerByPuuid: async (puuid: string) => {
      await testDb.insert(riotAccounts).values({ userId: "racer", ...faker, summonerLevel: 1, profileIconId: 0 });
      return riot.getSummonerByPuuid(puuid);
    },
  });
  expect(await linkRsoAccount({ db: testDb, riot: racing }, "c", faker.puuid)).toEqual({ ok: false, reason: "taken_by_other" });
});

test("Riot failing while linking stores nothing", async () => {
  await createTestUser("c");
  riot.setUnavailable(faker.puuid);
  expect(await linkRsoAccount(deps(), "c", faker.puuid)).toEqual({ ok: false, reason: "riot_unavailable" });
  expect(await testDb.select().from(riotAccounts)).toHaveLength(0);
});
