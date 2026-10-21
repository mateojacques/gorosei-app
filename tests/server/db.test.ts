import { beforeEach, expect, test } from "bun:test";
import { riotAccounts, user } from "../../src/server/db/schema";
import { resetTestDb, testDb } from "../helpers/db";

beforeEach(resetTestDb);

async function insertUser(id: string) {
  await testDb.insert(user).values({ id, name: id, email: `${id}@test.local` });
}

function account(userId: string, puuid: string) {
  return { userId, puuid, gameName: "Señor Café", tagLine: "LAS", summonerLevel: 100, profileIconId: 1 };
}

test("riot_accounts rejects a duplicate puuid", async () => {
  await insertUser("u1");
  await insertUser("u2");
  await testDb.insert(riotAccounts).values(account("u1", "puuid-1"));

  const second = testDb.insert(riotAccounts).values(account("u2", "puuid-1")).execute();

  await expect(second).rejects.toMatchObject({ cause: { code: "23505" } });
});

test("resetTestDb leaves riot_accounts empty", async () => {
  await insertUser("u1");
  await testDb.insert(riotAccounts).values(account("u1", "puuid-1"));

  await resetTestDb();

  expect(await testDb.select().from(riotAccounts)).toEqual([]);
});
