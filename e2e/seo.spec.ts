import { expect, test } from "@playwright/test";
import { resetTestDb } from "../tests/helpers/db";
import { seedPublicRoutes, seededRiotId, seededTeam, seededTournament } from "./public-routes";
import { riotIdToSlug } from "../src/shared/riot-id";
import { createTestTournament } from "../tests/helpers/competition";

let draftSlug: string;

test.beforeAll(async () => {
  await resetTestDb();
  await seedPublicRoutes();
  draftSlug = (await createTestTournament({ title: "Copa Oculta", status: "draft" })).slug;
});

test("the sitemap lists public pages and never a draft", async ({ request }) => {
  const res = await request.get("/sitemap.xml");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/xml");
  const xml = await res.text();
  expect(xml).toContain(`<loc>http://localhost:3100/torneos/${seededTournament.slug}</loc>`);
  expect(xml).toContain(`<loc>http://localhost:3100/equipos/${seededTeam.slug}</loc>`);
  expect(xml).toContain(`<loc>http://localhost:3100/jugador/${riotIdToSlug(seededRiotId)}</loc>`);
  expect(xml).not.toContain(draftSlug);
});

test("robots.txt points at the sitemap", async ({ request }) => {
  const txt = await (await request.get("/robots.txt")).text();
  expect(txt).toContain("Sitemap: http://localhost:3100/sitemap.xml");
  expect(txt).toContain("Disallow: /admin");
});

test("tournament share images are PNGs; drafts are 404", async ({ request }) => {
  const res = await request.get(`/og/torneos/${seededTournament.slug}.png`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect([...(await res.body()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect((await request.get(`/og/torneos/${draftSlug}.png`)).status()).toBe(404);
  expect((await request.get("/og/default.png")).status()).toBe(200);
});

test("the tournament page points og:image at its share image", async ({ page }) => {
  await page.goto(`/torneos/${seededTournament.slug}`);
  expect(await page.locator('meta[property="og:image"]').getAttribute("content")).toBe(
    `http://localhost:3100/og/torneos/${seededTournament.slug}.png`,
  );
  await page.goto(`/torneos/${draftSlug}`);
  await expect(page.locator('meta[property="og:image"]')).not.toHaveAttribute("content", /Oculta|oculta/);
});
