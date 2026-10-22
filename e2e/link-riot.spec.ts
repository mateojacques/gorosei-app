import { expect, test } from "@playwright/test";
import { riotLinkChallenges } from "../src/server/db/schema";
import { resetTestDb, testDb } from "../tests/helpers/db";
import { createPlayer } from "./helpers/players";

test("the verification step shows the icon to set, not a number", async ({ browser }) => {
  await resetTestDb();
  const player = await createPlayer({ name: "Nuevo", email: "nuevo@test.local" });
  await testDb.insert(riotLinkChallenges).values({
    userId: player.userId,
    puuid: "puuid-nuevo",
    gameName: "Nuevo",
    tagLine: "LAS",
    requiredIconId: 11,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  const context = await browser.newContext({ storageState: player.storageState, baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  await page.goto("/vincular-riot");

  const icon = page.getByRole("img", { name: "El ícono de perfil que tenés que poner" });
  await expect(icon).toHaveAttribute("src", /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/[\d.]+\/img\/profileicon\/11\.png$/);
  await expect(page.locator("main")).not.toContainText("número");
});
