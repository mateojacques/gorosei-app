import { type Browser, expect, test } from "@playwright/test";
import { resetTestDb } from "../tests/helpers/db";
import { type StorageState, createPlayer } from "./helpers/players";

test.use({ javaScriptEnabled: true });
// The team created in the first test is the one the later tests invite into and render.
test.describe.configure({ mode: "serial" });

let captain: StorageState;
let invitee: StorageState;
let unlinked: StorageState;

test.beforeAll(async () => {
  await resetTestDb();
  captain = (
    await createPlayer({
      name: "Capitán",
      email: "capitan@test.local",
      riot: { gameName: "Capitán", tagLine: "LAS", rank: { tier: "GOLD", division: "II", lp: 10 } },
    })
  ).storageState;
  invitee = (
    await createPlayer({
      name: "Café",
      email: "cafe@test.local",
      riot: { gameName: "Señor Café", tagLine: "LAS", rank: { tier: "DIAMOND", division: "I", lp: 40 } },
    })
  ).storageState;
  unlinked = (await createPlayer({ name: "Sin Riot", email: "sinriot@test.local" })).storageState;
});

async function pageAs(browser: Browser, storageState: StorageState) {
  const context = await browser.newContext({ storageState, javaScriptEnabled: true, baseURL: "http://localhost:3100" });
  return context.newPage();
}

test("a linked player creates a team and lands on its page", async ({ browser }) => {
  const page = await pageAs(browser, captain);
  await page.goto("/equipos/nuevo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nombre del equipo").fill("Los Pibes");
  await page.getByLabel("Tag").fill("PBS");
  await page.getByRole("button", { name: "Crear equipo" }).click();

  await expect(page).toHaveURL(/\/equipos\/los-pibes$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Los Pibes");
  await expect(page.getByText("[PBS]")).toBeVisible();
});

test("the captain invites a player, who accepts from Mis equipos and joins the roster", async ({ browser }) => {
  const captainPage = await pageAs(browser, captain);
  await captainPage.goto("/equipos/los-pibes");
  await captainPage.waitForLoadState("networkidle");
  await captainPage.getByLabel("Riot ID").fill("Señor Café#LAS");
  await captainPage.getByRole("button", { name: "Invitar" }).click();
  await expect(captainPage.getByRole("table", { name: "Solicitudes pendientes" })).toContainText("Señor Café#LAS");

  const inviteePage = await pageAs(browser, invitee);
  await inviteePage.goto("/mis-equipos");
  await inviteePage.waitForLoadState("networkidle");
  const invites = inviteePage.getByRole("table", { name: "Invitaciones" });
  await expect(invites).toContainText("Los Pibes");
  await invites.getByRole("button", { name: "Aceptar" }).click();
  await expect(inviteePage.getByRole("table", { name: "Tus equipos" })).toContainText("Los Pibes");

  await inviteePage.goto("/equipos/los-pibes");
  await expect(inviteePage.getByRole("table", { name: "Roster" })).toContainText("Señor Café#LAS");
});

test("a player without Riot is told to link it when creating a team", async ({ browser }) => {
  const page = await pageAs(browser, unlinked);
  await page.goto("/equipos/nuevo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nombre del equipo").fill("Sin Cuenta");
  await page.getByLabel("Tag").fill("SNC");
  await page.getByRole("button", { name: "Crear equipo" }).click();

  await expect(page.getByRole("alert")).toHaveText("Necesitás vincular tu cuenta de Riot para hacer esto.");
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("the team page is server-rendered with its name and roster", async ({ request }) => {
    const res = await request.get("/equipos/los-pibes");
    const html = await res.text();

    expect(res.status()).toBe(200);
    expect(html).toMatch(/<h1[^>]*>Los Pibes<\/h1>/);
    expect(html).toContain("Capitán#LAS");
    expect(html).toContain("Señor Café#LAS");
  });
});
