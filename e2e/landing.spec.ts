import { expect, test } from "@playwright/test";
import { resetTestDb } from "../tests/helpers/db";

test.beforeAll(resetTestDb);

test.describe("without JavaScript", () => {
  test("the landing page is fully server-rendered", async ({ request }) => {
    const res = await request.get("/");
    const html = await res.text();

    expect(res.status()).toBe(200);
    for (const text of [/COPA/i, /SEMANAL/i, /LAS · Edición #1/i]) expect(html).toMatch(text);
    for (const text of [
      "SÁB 7/11",
      "18:00",
      "$300.000",
      "Premio para el equipo campeón",
      "Quiénes",
      "Qué",
      "Dónde",
      "Entrada",
      "Diamante",
      "el pozo es el premio",
    ]) {
      expect(html).toContain(text);
    }
    expect(html).toMatch(/<a [^>]*href="\/ingresar"[^>]*>Preparate: creá tu cuenta<\/a>/);
    expect(html).toMatch(/<title>[^<]*Copa Semanal[^<]*<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]*\$300\.000[^"]*SÁB 7\/11[^"]*"/);
  });
});

test.describe("with JavaScript", () => {
  test.use({ javaScriptEnabled: true });

  test("the countdown ticks", async ({ page }) => {
    await page.goto("/");
    // The dev server hydrates late on a cold start; read the countdown once the client has taken over.
    await page.waitForLoadState("networkidle");
    const countdown = page.locator("[data-remaining]");
    await expect(countdown).toHaveText(/\d+d \d{2}h \d{2}m/);
    const first = Number(await countdown.getAttribute("data-remaining"));
    await page.waitForTimeout(1500);
    const second = Number(await countdown.getAttribute("data-remaining"));
    expect(second).toBeLessThan(first);
  });

  test("reduced-motion visitors get no animations", async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    await context.close();
  });
});

test("signed-in visitors without Riot are asked to link it", async ({ request, baseURL }) => {
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: { origin: baseURL! },
    data: { name: "Landing", email: "landing@test.local", password: "contraseña-segura" },
  });
  expect(signUp.ok()).toBe(true);

  const html = await (await request.get("/")).text();
  expect(html).toMatch(/<a [^>]*href="\/vincular-riot"[^>]*>Vinculá tu cuenta de Riot<\/a>/);
  expect(html).not.toContain("Preparate: creá tu cuenta");
});
