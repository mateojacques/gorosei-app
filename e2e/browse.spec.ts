import { expect, test } from "@playwright/test";
import { resetTestDb } from "../tests/helpers/db";
import { createTestTournament } from "../tests/helpers/competition";
import { createPlayer } from "./helpers/players";
import { RIOT_NOTICE } from "./public-routes";

const at = (iso: string, closesIso: string) => ({ startsAt: new Date(iso), registrationClosesAt: new Date(closesIso) });

test.beforeAll(async () => {
  await resetTestDb();
  await createTestTournament({
    title: "Copa Abierta",
    status: "registration_open",
    bracket: "single_elimination",
    ...at("2026-11-07T21:00:00Z", "2026-11-06T21:00:00Z"),
  });
  await createTestTournament({ title: "Copa En Juego", status: "live", ...at("2026-10-20T21:00:00Z", "2026-10-19T21:00:00Z") });
  await createTestTournament({ title: "Copa Terminada", status: "finished", ...at("2026-10-10T21:00:00Z", "2026-10-09T21:00:00Z") });
  await createTestTournament({ title: "Copa Borrador", status: "draft" });
});

test.describe("without JavaScript", () => {
  test("lists open cups first, then live, then finished; never drafts", async ({ page }) => {
    await page.goto("/torneos");
    const headings = await page.getByRole("heading", { level: 2 }).allTextContents();
    expect(headings.map((h) => h.replace(/\d+$/, "").trim())).toEqual(["Próximas", "En vivo", "Finalizados"]);
    const titles = await page.getByRole("heading", { level: 3 }).allTextContents();
    expect(titles.map((x) => x.replace(/ #\d+$/, ""))).toEqual(["Copa Abierta", "Copa En Juego", "Copa Terminada"]);
    await expect(page.getByText("Copa Borrador")).toHaveCount(0);
    await expect(page.getByText(RIOT_NOTICE)).toBeVisible();
  });

  test("the format filter hides other cups and offers to clear", async ({ page }) => {
    await page.goto("/torneos?format=single_elimination");
    await expect(page.getByRole("heading", { level: 3 })).toHaveText([/Copa Abierta/]);
    await expect(page.getByRole("link", { name: "Borrar filtros" })).toBeVisible();
    await page.goto("/torneos?format=single_elimination&rank=IRON");
    await expect(page.getByText("Ninguna copa coincide con esos filtros.")).toBeVisible();
  });

  test("the filter form works without JavaScript", async ({ page }) => {
    await page.goto("/torneos");
    await page.getByLabel("Formato").selectOption("double_elimination");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page).toHaveURL(/format=double_elimination/);
    await expect(page.getByRole("heading", { level: 3 })).toHaveText([/Copa En Juego/, /Copa Terminada/]);
  });

  test("the header link goes to the browse page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("navigation").getByRole("link", { name: "Torneos" }).click();
    await expect(page).toHaveURL(/\/torneos$/);
    await expect(page.getByRole("heading", { level: 1, name: "Torneos" })).toBeVisible();
  });

  test("no horizontal scroll at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/torneos");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});

test.describe("signed in", () => {
  test.use({ javaScriptEnabled: true });
  test("the header still fits at 320px with every account link", async ({ browser }) => {
    const player = await createPlayer({ name: "browse", email: "browse@test.local", riot: { gameName: "Navegante", tagLine: "LAS" } });
    const context = await browser.newContext({ storageState: player.storageState, viewport: { width: 320, height: 800 } });
    const page = await context.newPage();
    await page.goto("/torneos");
    await expect(page.getByRole("link", { name: "Mi perfil" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await context.close();
  });
});
