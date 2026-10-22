import { type Browser, expect, test } from "@playwright/test";
import { tournaments } from "../src/server/db/schema";
import { resetTestDb, testDb } from "../tests/helpers/db";
import { type StorageState, createPlayer } from "./helpers/players";

test.use({ javaScriptEnabled: true });
test.describe.configure({ mode: "serial" });

let admin: StorageState;
let player: StorageState;

test.beforeAll(async () => {
  await resetTestDb();
  admin = (await createPlayer({ name: "Admin", email: "admin@test.local", role: "admin" })).storageState;
  player = (await createPlayer({ name: "Jugador", email: "jugador@test.local" })).storageState;
});

async function pageAs(browser: Browser, storageState: StorageState) {
  const context = await browser.newContext({ storageState, javaScriptEnabled: true, baseURL: "http://localhost:3100" });
  return context.newPage();
}

test("players and visitors get the not-found page, never a hint of the admin area", async ({ browser, request }) => {
  const page = await pageAs(browser, player);
  const res = await page.goto("/admin/torneos");
  expect(res!.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sin señal");

  const anonymous = await request.get("/admin/torneos");
  expect(anonymous.status()).toBe(404);
});

test("an admin creates a tournament, opens registration and it goes public", async ({ browser }) => {
  const page = await pageAs(browser, admin);
  await page.goto("/admin/torneos/nuevo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Título").fill("Copa Semanal LAS");
  await page.getByLabel("Edición").fill("1");
  await page.getByLabel("Empieza (ART)").fill("2026-11-07T18:00");
  await page.getByLabel("Cierra la inscripción (ART)").fill("2026-11-06T18:00");
  await page
    .getByLabel("Reglas de elegibilidad (JSON)")
    .fill('[{"id":"r1","type":"player_rank_range","max":{"tier":"DIAMOND","division":"IV"}}]');
  await expect(page.getByText("Rango máximo por jugador: Diamante IV")).toBeVisible();
  await page.getByRole("button", { name: "Crear torneo" }).click();

  await expect(page).toHaveURL(/\/admin\/torneos\/[0-9a-f-]{36}$/);
  await page.goto("/admin/torneos");
  const row = page.getByRole("row", { name: /copa-semanal-las-1/ });
  await expect(row).toContainText("Borrador");

  await row.getByRole("link").first().click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "Abrir inscripción" }).click();
  await expect(page.getByText("Inscripción abierta").first()).toBeVisible();

  await page.goto("/torneos/copa-semanal-las-1");
  await expect(page.getByText("Inscripción abierta").first()).toBeVisible();
});

test("invalid eligibility rules show an alert and save nothing", async ({ browser }) => {
  const page = await pageAs(browser, admin);
  await page.goto("/admin/torneos/nuevo");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Título").fill("Copa Rota");
  await page.getByLabel("Edición").fill("1");
  await page.getByLabel("Empieza (ART)").fill("2026-11-07T18:00");
  await page.getByLabel("Cierra la inscripción (ART)").fill("2026-11-06T18:00");
  await page.getByLabel("Reglas de elegibilidad (JSON)").fill('[{"id":"r1","type":"nope"}]');
  await page.getByRole("button", { name: "Crear torneo" }).click();

  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/torneos\/nuevo$/);
  const rows = await testDb.select({ title: tournaments.title }).from(tournaments);
  expect(rows.map((r) => r.title)).not.toContain("Copa Rota");
});
