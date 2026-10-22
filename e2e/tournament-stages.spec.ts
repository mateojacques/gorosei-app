import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { registrations, teams } from "../src/server/db/schema";
import { createTestRegistration, createTestTeam, linkedPlayer, payFor } from "../tests/helpers/competition";
import { resetTestDb, testDb } from "../tests/helpers/db";
import { createPlayer } from "./helpers/players";
import { seedStageTournaments } from "./helpers/tournaments";

let seeded: Awaited<ReturnType<typeof seedStageTournaments>>;
const teamName = async (registrationId: string) =>
  (await testDb.select({ name: teams.name }).from(registrations).innerJoin(teams, eq(teams.id, registrations.teamId)).where(eq(registrations.id, registrationId)))[0]!
    .name;

test.beforeAll(async () => {
  await resetTestDb();
  seeded = await seedStageTournaments();
});

test.describe("without JavaScript", () => {
  test("the open cup is a landing page with schedule, prize warning, canonical and Event JSON-LD", async ({ page }) => {
    await page.goto(`/torneos/${seeded.open.slug}`);
    await expect(page.getByRole("heading", { level: 1, name: "Copa Abierta" })).toBeVisible();
    await expect(page.getByText("SÁB 7/11 · 18:00 ART").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Inscribí tu equipo" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Horario" })).toBeVisible();
    await expect(page.getByText("Cierra la inscripción")).toBeVisible();
    await expect(page.getByText(/El pozo es el premio: se reparte/)).toBeVisible();
    await expect(page.getByText("El cuadro se arma cuando cierra el check-in", { exact: false })).toBeVisible();
    expect(await page.locator('link[rel="canonical"]').getAttribute("href")).toBe(`http://localhost:3100/torneos/${seeded.open.slug}`);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    expect(ld["@type"]).toBe("Event");
    expect(ld.offers.price).toBe("5000");
    expect(ld.name).toBe(`Copa Abierta #${seeded.open.edition}`);
  });

  test("the live cup shows the stream link, the matches in play and the bracket", async ({ page }) => {
    await page.goto(`/torneos/${seeded.live.tournament.slug}`);
    await expect(page.getByText("En vivo").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /twitch\.tv\/gorosei/ })).toBeVisible();
    expect(await page.locator("iframe").count()).toBe(0);
    await expect(page.getByRole("heading", { name: "En juego ahora" })).toBeVisible();
    await expect(page.locator('section[aria-labelledby="in-play-h"] a[href^="/partidas/"]')).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: "Cuadro" })).toBeVisible();
    await expect(page.locator("section#main")).toBeVisible();
    await expect(page.locator("section#third_place")).toBeVisible();
    await expect(page.getByRole("region", { name: /rondas en columnas/ }).first()).toBeVisible();
  });

  test("a completed match opens the public match page with no lobby or chat", async ({ page }) => {
    await page.goto(`/torneos/${seeded.live.tournament.slug}`);
    await page.locator(`section#main a[href="/partidas/${seeded.liveCompletedMatchId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/partidas/${seeded.liveCompletedMatchId}$`));
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sala" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Chat de la partida" })).toHaveCount(0);
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toBe("noindex,follow");
  });

  test("the finished cup shows the champion, the prize, the podium, a VOD and the next cup", async ({ page }) => {
    const [champion, second, third] = await Promise.all(seeded.finished.teams.slice(0, 3).map((team) => teamName(team.registrationId)));
    await page.goto(`/torneos/${seeded.finished.tournament.slug}`);
    await expect(page.getByRole("link", { name: champion! }).first()).toBeVisible();
    await expect(page.getByText("$70.000")).toBeVisible();
    await expect(page.getByText("Premio del campeón")).toBeVisible();
    await expect(page.getByRole("link", { name: second! }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: third! }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver VOD" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=final");
    await expect(page.getByRole("link", { name: "Siguiente copa →" })).toHaveAttribute("href", `/torneos/${seeded.live.tournament.slug}`);
  });

  for (const stage of ["open", "live", "finished"] as const) {
    test(`no horizontal scroll at 320px on the ${stage} cup`, async ({ page }) => {
      const slug = stage === "open" ? seeded.open.slug : seeded[stage].tournament.slug;
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(`/torneos/${slug}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  }

  test("a draft is not found", async ({ page }) => {
    const res = await page.goto(`/torneos/${seeded.draft.slug}`);
    expect(res?.status()).toBe(404);
  });
});

test.describe("with JavaScript", () => {
  test.use({ javaScriptEnabled: true });

  test("the live stream and chat mount with parent=localhost", async ({ page }) => {
    await page.goto(`/torneos/${seeded.live.tournament.slug}`);
    const frames = page.locator("iframe");
    await expect(frames).toHaveCount(2);
    for (const src of await frames.evaluateAll((els) => els.map((e) => e.getAttribute("src") ?? ""))) {
      expect(src).toContain("parent=localhost");
      expect(src).toContain("gorosei");
    }
  });

  test("a signed-in player sees their checklist with the right states", async ({ browser }) => {
    const player = await createPlayer({ name: "checklist", email: "checklist@test.local", riot: { gameName: "Lista", tagLine: "LAS" } });
    const mates = await Promise.all(["ck1", "ck2", "ck3"].map((id) => linkedPlayer(id)));
    const team = await createTestTeam(player.userId, mates, "Los Que Faltan");
    await createTestRegistration(seeded.open.id, team.id, { starters: [player.userId, ...mates], subs: [] });
    for (const id of [player.userId, ...mates.slice(0, 2)]) await payFor(seeded.open.id, id);

    const context = await browser.newContext({ storageState: player.storageState });
    const page = await context.newPage();
    await page.goto(`/torneos/${seeded.open.slug}`);
    const status = page.locator('section[aria-labelledby="your-status-h"]');
    await expect(status.getByRole("heading", { name: "Tu estado" })).toBeVisible();
    await expect(status.getByText("Listo: Cuenta de Riot vinculada")).toBeVisible();
    await expect(status.getByText("Pendiente: Equipo: 4/5 titulares")).toBeVisible();
    await expect(status.getByText("Pendiente: Pagos: 3/5")).toBeVisible();
    await expect(status.getByRole("link", { name: "Ver equipo" })).toHaveAttribute("href", `/equipos/${team.slug}`);
    await context.close();
  });
});
