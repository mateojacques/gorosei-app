import { expect, test } from "@playwright/test";
import { rankSnapshots } from "../src/server/db/schema";
import { riotIdToSlug } from "../src/shared/riot-id";
import { createTestTeam } from "../tests/helpers/competition";
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
  await createTestTeam("e2e-user", [], "Los Pibes");
});

test("profile is server-rendered with title, description and rank", async ({ request }) => {
  const res = await request.get(`/jugador/${riotIdToSlug(riotId)}`);
  const html = await res.text();

  expect(res.status()).toBe(200);
  expect(html).toContain("Señor Café#LAS");
  expect(html).toContain("Diamante I");
  expect(html).toMatch(/<title>[^<]*Señor Café#LAS[^<]*<\/title>/);
  expect(html).toMatch(/<meta name="description" content="[^"]+"/);
  expect(html).toMatch(/<h1[^>]*>Señor Café#LAS<\/h1>/);
  expect(html).toMatch(/<dt[^>]*>Rango actual<\/dt><dd[^>]*>Diamante I<\/dd>/);
  expect(html).toMatch(/<dt[^>]*>Pico de temporada<\/dt><dd[^>]*>Diamante I<\/dd>/);
});

test("the profile links to the player's teams", async ({ request }) => {
  const html = await (await request.get(`/jugador/${riotIdToSlug(riotId)}`)).text();
  expect(html).toMatch(/<a [^>]*href="\/equipos\/los-pibes"[^>]*>Los Pibes/);
});

test("unknown players get a friendly 404", async ({ request }) => {
  const res = await request.get(`/jugador/${riotIdToSlug({ gameName: "Nadie", tagLine: "LAS" })}`);

  const html = await res.text();
  const main = html.match(/<main[\s\S]*<\/main>/)?.[0] ?? "";

  expect(res.status()).toBe(404);
  expect(html).toContain("No encontramos a ese jugador");
  // A way back to the cup inside the page itself, not just the header wordmark.
  expect(main).toMatch(/<a [^>]*href="\/"/);
});
