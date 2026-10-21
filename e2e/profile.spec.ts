import { expect, test } from "@playwright/test";
import { rankSnapshots } from "../src/server/db/schema";
import { riotIdToSlug } from "../src/shared/riot-id";
import { createTestRiotAccount, resetTestDb, testDb } from "../tests/helpers/db";

const riotId = { gameName: "Señor Café", tagLine: "LAS" };

test.beforeAll(async () => {
  await resetTestDb();
  const accountId = await createTestRiotAccount("e2e-user", { puuid: "e2e-puuid", ...riotId });
  await testDb.insert(rankSnapshots).values({
    riotAccountId: accountId,
    tier: "DIAMOND",
    division: "I",
    lp: 40,
    wins: 20,
    losses: 10,
    observedAt: new Date(),
  });
});

test("profile is server-rendered with title, description and rank", async ({ request }) => {
  const res = await request.get(`/jugador/${riotIdToSlug(riotId)}`);
  const html = await res.text();

  expect(res.status()).toBe(200);
  expect(html).toContain("Señor Café#LAS");
  expect(html).toContain("Diamante I");
  expect(html).toMatch(/<title>[^<]*Señor Café#LAS[^<]*<\/title>/);
  expect(html).toMatch(/<meta name="description" content="[^"]+"/);
});

test("unknown players get a friendly 404", async ({ request }) => {
  const res = await request.get(`/jugador/${riotIdToSlug({ gameName: "Nadie", tagLine: "LAS" })}`);

  expect(res.status()).toBe(404);
  expect(await res.text()).toContain("No encontramos a ese jugador");
});
