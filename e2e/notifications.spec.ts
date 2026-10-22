import { type Browser, expect, test } from "@playwright/test";
import { createTeam } from "../src/server/teams/teams";
import { resetTestDb, testDb } from "../tests/helpers/db";
import { type StorageState, createPlayer } from "./helpers/players";

test.use({ javaScriptEnabled: true });
test.describe.configure({ mode: "serial" });

let captain: StorageState;
let player: StorageState;

test.beforeAll(async () => {
  await resetTestDb();
  const created = await createPlayer({
    name: "Capitán",
    email: "capitan@test.local",
    riot: { gameName: "Capitán", tagLine: "LAS" },
  });
  captain = created.storageState;
  const team = await createTeam(testDb, created.userId, { name: "Los Pibes", tag: "PBS" });
  if (!team.ok) throw new Error(team.reason);
  player = (await createPlayer({ name: "Café", email: "cafe@test.local", riot: { gameName: "Señor Café", tagLine: "LAS" } }))
    .storageState;
});

async function pageAs(browser: Browser, storageState: StorageState, width = 1280) {
  const context = await browser.newContext({
    storageState,
    javaScriptEnabled: true,
    baseURL: "http://localhost:3100",
    viewport: { width, height: 800 },
  });
  return context.newPage();
}

test("an invite shows up in the player's header and inbox, and reading it clears the count", async ({ browser }) => {
  const captainPage = await pageAs(browser, captain);
  await captainPage.goto("/equipos/los-pibes");
  await captainPage.waitForLoadState("networkidle");
  await captainPage.getByLabel("Riot ID").fill("Señor Café#LAS");
  await captainPage.getByRole("button", { name: "Invitar" }).click();
  await expect(captainPage.getByRole("table", { name: "Solicitudes pendientes" })).toContainText("Señor Café#LAS");

  const page = await pageAs(browser, player);
  await page.goto("/torneos");
  await expect(page.getByRole("link", { name: "Avisos, 1 sin leer" })).toBeVisible();
  await page.getByRole("link", { name: "Avisos, 1 sin leer" }).click();
  await expect(page).toHaveURL(/\/notificaciones$/);
  const invite = page.getByRole("link", { name: /Te invitaron a Los Pibes/ });
  await expect(invite).toBeVisible();
  await expect(invite).toHaveAttribute("href", "/mis-equipos");
  await page.waitForLoadState("networkidle");

  await page.reload();
  await expect(page.getByRole("link", { name: "Avisos", exact: true })).toBeVisible();
  await page.goto("/torneos");
  await expect(page.getByRole("link", { name: "Avisos", exact: true })).toBeVisible();
});

test("turning email off persists across reloads", async ({ browser }) => {
  const page = await pageAs(browser, player);
  await page.goto("/notificaciones");
  await page.waitForLoadState("networkidle");
  const email = page.getByLabel("Recibir avisos por email");
  await expect(email).toBeChecked();
  await email.uncheck();
  await expect(email).toBeEnabled();
  await page.reload();
  await expect(page.getByLabel("Recibir avisos por email")).not.toBeChecked();
});

test("signed out, the inbox sends you to sign in", async ({ page }) => {
  await page.goto("/notificaciones");
  await expect(page).toHaveURL(/\/ingresar$/);
});

test("the inbox has no horizontal scroll at 320px", async ({ browser }) => {
  const page = await pageAs(browser, player, 320);
  await page.goto("/notificaciones");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
