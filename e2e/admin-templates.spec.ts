import { type Browser, expect, test } from "@playwright/test";
import { tournamentTemplates } from "../src/server/db/schema";
import { formatCupDay, formatCupTime } from "../src/shared/format";
import { planNextEdition } from "../src/shared/templates";
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

async function pageAs(browser: Browser, storageState: StorageState, width = 1280) {
  const context = await browser.newContext({
    storageState,
    javaScriptEnabled: true,
    baseURL: "http://localhost:3100",
    viewport: { width, height: 800 },
  });
  return context.newPage();
}

test("players get the not-found page", async ({ browser }) => {
  const page = await pageAs(browser, player);
  const res = await page.goto("/admin/plantillas");
  expect(res!.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sin señal");
});

test("an invalid start time shows the field error and saves nothing", async ({ browser }) => {
  const page = await pageAs(browser, admin);
  await page.goto("/admin/plantillas/nueva");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Título").fill("Copa Rota");
  await page.getByLabel("Hora de inicio (ART)").fill("7:05");
  await page.getByRole("button", { name: "Crear plantilla" }).click();
  await expect(page.getByText("Usá el formato HH:MM, por ejemplo 18:00.")).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/plantillas\/nueva$/);
  expect(await testDb.select().from(tournamentTemplates)).toHaveLength(0);
});

test("an admin creates a weekly template and pauses it", async ({ browser }) => {
  const page = await pageAs(browser, admin);
  await page.goto("/admin/torneos");
  await page.getByRole("link", { name: "Plantillas" }).click();
  await expect(page).toHaveURL(/\/admin\/plantillas$/);
  await page.getByRole("link", { name: "Nueva plantilla" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Título").fill("Copa Semanal LAS");
  await page.getByLabel("Día", { exact: true }).selectOption({ label: "Sábado" });
  await page.getByLabel("Hora de inicio (ART)").fill("18:00");
  await page.getByLabel("Próxima edición", { exact: true }).fill("13");
  await page.getByRole("button", { name: "Crear plantilla" }).click();
  await expect(page).toHaveURL(/\/admin\/plantillas\/[0-9a-f-]{36}$/);

  const next = planNextEdition(
    { weekday: 6, startTime: "18:00", registrationOpensDaysBefore: 7, registrationClosesMinutesBefore: 120 },
    null,
    false,
    new Date(),
  )!.startsAt;
  await page.goto("/admin/plantillas");
  const row = page.getByRole("row", { name: /Copa Semanal LAS/ });
  await expect(row).toContainText("Sábado 18:00 ART");
  await expect(row).toContainText(`#13 · ${formatCupDay(next)} ${formatCupTime(next)}`);

  await row.getByRole("link", { name: "Copa Semanal LAS" }).click();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Activa").uncheck();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("status")).toHaveText("Cambios guardados.");
  await page.goto("/admin/plantillas");
  await expect(page.getByRole("row", { name: /Copa Semanal LAS/ })).toContainText("Pausada");
});

test("the template pages have no horizontal scroll at 320px", async ({ browser }) => {
  const page = await pageAs(browser, admin, 320);
  for (const path of ["/admin/plantillas", "/admin/plantillas/nueva"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
