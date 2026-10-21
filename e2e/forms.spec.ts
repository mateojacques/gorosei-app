import { expect, test } from "@playwright/test";
import { resetTestDb } from "../tests/helpers/db";

test.use({ javaScriptEnabled: true });
test.beforeAll(resetTestDb);

test("sign-in fields are labelled and the submit button shows its focus", async ({ page }) => {
  await page.goto("/ingresar");
  await page.waitForLoadState("networkidle");

  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toBeVisible();

  const submit = page.getByRole("button", { name: "Iniciar sesión" });
  await page.getByLabel("Contraseña").focus();
  await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  const focusStyle = await submit.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth), matches: el.matches(":focus-visible") };
  });
  // Our ring, not the browser's default "auto" outline.
  expect(focusStyle).toEqual({ style: "solid", width: 2, matches: true });

  await page.getByRole("button", { name: "¿No tenés cuenta? Creala" }).click();
  await expect(page.getByLabel("Nombre")).toBeVisible();
});

test("an invalid Riot ID is announced as an alert", async ({ page, baseURL }) => {
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers: { origin: baseURL! },
    data: { name: "Forms", email: "forms@test.local", password: "contraseña-segura" },
  });
  expect(signUp.ok()).toBe(true);

  await page.goto("/vincular-riot");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Riot ID").fill("nohash");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByRole("alert")).toHaveText("Ese Riot ID no es válido. Usá el formato nombre#tag.");
});
