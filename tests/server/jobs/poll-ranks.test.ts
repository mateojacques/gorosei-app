import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { rankSnapshots, riotAccounts } from "../../../src/server/db/schema";
import { pollAllRanks } from "../../../src/server/jobs/poll-ranks";
import { createTestRiotAccount, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

const NOW = new Date("2026-10-21T12:00:00Z");
let riot: FakeRiotClient;

beforeEach(async () => {
  await resetTestDb();
  riot = new FakeRiotClient();
  for (const n of [1, 2, 3]) {
    const id = { puuid: `p${n}`, gameName: `Jugador ${n}`, tagLine: "LAS" };
    riot.addAccount({ ...id, summonerLevel: 100 + n });
    await createTestRiotAccount(`u${n}`, id);
  }
});

test("polls every account and counts failures", async () => {
  riot.setUnavailable("p2");

  expect(await pollAllRanks({ db: testDb, riot, now: () => NOW })).toEqual({ polled: 2, failed: 1 });
  expect(await testDb.select().from(rankSnapshots)).toHaveLength(2);
});

test("refreshes Riot ID, level and last poll time", async () => {
  riot.rename("p1", "Nuevo Nombre", "ARG");

  await pollAllRanks({ db: testDb, riot, now: () => NOW });

  const [account] = await testDb.select().from(riotAccounts).where(eq(riotAccounts.puuid, "p1"));
  expect(account).toMatchObject({ gameName: "Nuevo Nombre", tagLine: "ARG", summonerLevel: 101, lastPolledAt: NOW });
});

test("polls never-polled accounts first, then the stalest", async () => {
  await testDb.update(riotAccounts).set({ lastPolledAt: new Date("2026-10-20T00:00:00Z") }).where(eq(riotAccounts.puuid, "p1"));
  await testDb.update(riotAccounts).set({ lastPolledAt: new Date("2026-10-19T00:00:00Z") }).where(eq(riotAccounts.puuid, "p3"));
  const order: string[] = [];
  const spy = Object.assign(Object.create(riot), {
    getSoloRankByPuuid: (puuid: string) => (order.push(puuid), riot.getSoloRankByPuuid(puuid)),
  });

  await pollAllRanks({ db: testDb, riot: spy, now: () => NOW });

  expect(order).toEqual(["p2", "p3", "p1"]);
});
