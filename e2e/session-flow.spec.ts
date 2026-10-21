import { expect, test } from "@playwright/test";
import { resetTestDb } from "../tests/helpers/db";

test.use({ javaScriptEnabled: true });
test.beforeAll(resetTestDb);

test("signing up through the form updates the header and the landing CTA without a reload", async ({ page }) => {
  await page.goto("/ingresar");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: "¿No tenés cuenta? Creala" }).click();
  await page.getByLabel("Nombre").fill("Flujo");
  await page.getByLabel("Email").fill("flujo@test.local");
  await page.getByLabel("Contraseña").fill("contraseña-segura");
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page).toHaveURL(/\/vincular-riot$/);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Vinculá Riot" })).toBeVisible();

  await page.getByRole("link", { name: "Gorosei" }).click();
  await expect(page.getByRole("link", { name: "Vinculá tu cuenta de Riot" })).toBeVisible();
});

test("the countdown switches to the live state once the cup has started", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-11-07T21:00:05Z") });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("[data-remaining]")).toHaveText("En juego");
});

test("unknown URLs get the Spanish not-found page with a way home", async ({ request }) => {
  const res = await request.get("/no-existe");
  const html = await res.text();
  const main = html.match(/<main[\s\S]*<\/main>/)?.[0] ?? "";

  expect(res.status()).toBe(404);
  expect(main).toContain("Sin señal");
  expect(main).toMatch(/<a [^>]*href="\/"/);
});
