import { type Browser, type Page, expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
import { checkIns, matches, tournaments } from "../src/server/db/schema";
import { closeCheckIn } from "../src/server/matchday/check-in";
import { confirmMatch } from "../src/server/matchday/moderation";
import { checkedInTestTeam, createTestRegistration, createTestTeam, createTestTournament } from "../tests/helpers/competition";
import { resetTestDb, testDb } from "../tests/helpers/db";
import { type StorageState, createPlayer } from "./helpers/players";

test.use({ javaScriptEnabled: true });
test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const BASE_URL = "http://localhost:3100";
// Realtime may or may not be reachable in the e2e server; the 15 s poll keeps the page current either way.
const LIVE = { timeout: 40_000 };

async function pageAs(browser: Browser, storageState: StorageState): Promise<Page> {
  const context = await browser.newContext({ storageState, javaScriptEnabled: true, baseURL: BASE_URL });
  return context.newPage();
}

type Created = Awaited<ReturnType<typeof createPlayer>>;

let tournament: Awaited<ReturnType<typeof createTestTournament>>;
let alfa: { captain: Created; mates: Created[]; registrationId: string };
let beta: { captain: Created; mates: Created[]; registrationId: string };
let moderator: Created;
let outsider: Created;
let matchId: string;

async function squad(prefix: string, teamName: string, tier: "CHALLENGER" | "IRON") {
  const players: Created[] = [];
  for (const n of [1, 2, 3, 4, 5]) {
    players.push(
      await createPlayer({
        name: `${prefix}${n}`,
        email: `${prefix.toLowerCase()}${n}@test.local`,
        riot: { gameName: `${prefix}${n}`, tagLine: "LAS", rank: { tier, division: "I", lp: 0 } },
      }),
    );
  }
  const team = await createTestTeam(players[0]!.userId, players.slice(1).map((p) => p.userId), teamName);
  const registrationId = await createTestRegistration(tournament.id, team.id, { starters: players.map((p) => p.userId), subs: [] });
  return { captain: players[0]!, mates: players.slice(1), registrationId };
}

test.beforeAll(async () => {
  await resetTestDb();
  tournament = await createTestTournament({
    title: "Copa Partidas",
    edition: 1,
    status: "registration_open",
    entryFeeArs: 0,
    bracket: "single_elimination",
    rankSource: "current",
    startsAt: new Date(Date.now() + 30 * 60_000),
    registrationClosesAt: new Date(Date.now() + 20 * 60_000),
  });
  alfa = await squad("Alfa", "Los Alfa", "CHALLENGER");
  await checkedInTestTeam(tournament, "fx", 6, { rank: { tier: "GRANDMASTER", division: "I", lp: 0 } });
  await checkedInTestTeam(tournament, "fy", 6, { rank: { tier: "MASTER", division: "I", lp: 0 } });
  beta = await squad("Beta", "Los Beta", "IRON");
  moderator = await createPlayer({ name: "Moderadora", email: "mod@test.local", role: "moderator" });
  outsider = await createPlayer({ name: "Ajeno", email: "ajeno@test.local", riot: { gameName: "Ajeno", tagLine: "LAS" } });
  await testDb.update(tournaments).set({ status: "check_in" }).where(eq(tournaments.id, tournament.id));
});

test("the captain checks in and sees the team's progress", async ({ browser }) => {
  const page = await pageAs(browser, alfa.captain.storageState);
  await page.goto(`/torneos/${tournament.slug}`);
  await expect(page.getByRole("heading", { name: /Check-in · Los Alfa/ })).toBeVisible();
  await expect(page.getByText("0 de 5 listos")).toBeVisible();
  await page.waitForLoadState("networkidle"); // hydrated, so the click reaches the handler
  await page.getByRole("button", { name: "Hacer check-in" }).click();
  await expect(page.getByText("Ya hiciste el check-in.")).toBeVisible();
  await expect(page.getByText("1 de 5 listos")).toBeVisible();
});

test("closing check-in builds the bracket and the moderator console shows the lobby to create", async ({ browser }) => {
  const rows = [
    ...alfa.mates.map((p) => ({ registrationId: alfa.registrationId, userId: p.userId })),
    ...[beta.captain, ...beta.mates].map((p) => ({ registrationId: beta.registrationId, userId: p.userId })),
  ];
  await testDb.insert(checkIns).values(rows.map((r) => ({ ...r, tournamentId: tournament.id })));
  expect(await closeCheckIn(testDb, tournament.id, new Date(), null, { force: true })).toMatchObject({ ok: true, outcome: "live" });
  const [m] = (await testDb.select().from(matches).where(eq(matches.tournamentId, tournament.id))).filter(
    (x) => x.status === "open" && [x.reg1Id, x.reg2Id].includes(alfa.registrationId),
  );
  matchId = m!.id;

  const page = await pageAs(browser, moderator.storageState);
  await page.goto("/mod");
  await expect(page.getByRole("heading", { name: "Consola de moderación" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Crear sala" }).filter({ hasText: "Los Alfa" });
  await expect(row).toHaveCount(1);
  await row.getByRole("link").click();
  await expect(page.getByLabel("Nombre de la sala")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Nombre de la sala").fill("gorosei-sala-1");
  await page.getByLabel("Contraseña de la sala").fill("clave123");
  await page.getByRole("button", { name: "Publicar sala" }).click();
  await expect(page.getByText("clave123")).toBeVisible();
});

test("captains report different results and the moderator override resolves the dispute", async ({ browser }) => {
  const a = await pageAs(browser, alfa.captain.storageState);
  const b = await pageAs(browser, beta.captain.storageState);
  for (const page of [a, b]) {
    await page.goto(`/partidas/${matchId}`);
    await expect(page.getByText("gorosei-sala-1", { exact: true })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Puntos de tu equipo").fill("1");
    await page.getByLabel("Puntos del rival").fill("0");
    await page.getByRole("button", { name: /Cargar resultado/ }).click();
  }
  await a.reload();
  await expect(a.getByText("Los reportes no coinciden. Un moderador va a resolverlo.")).toBeVisible();

  const mod = await pageAs(browser, moderator.storageState);
  await mod.goto(`/mod?match=${matchId}`);
  await expect(mod.getByText("En disputa").first()).toBeVisible();
  await mod.waitForLoadState("networkidle");
  await mod.getByLabel("Puntos de Los Alfa").fill("1");
  await mod.getByLabel("Puntos de Los Beta").fill("0");
  await mod.getByRole("button", { name: "Fijar resultado" }).click();
  await expect(mod.getByText("Listo.")).toBeVisible();
  await mod.reload();
  await expect(mod.getByText("Ganó Los Alfa")).toBeVisible();
});

test("the winner's next match opens on their tournament page without a reload", async ({ browser }) => {
  const page = await pageAs(browser, alfa.captain.storageState);
  await page.goto(`/torneos/${tournament.slug}`);
  await expect(page.getByText("No tenés una partida pendiente ahora.")).toBeVisible();

  // The other semifinal finishes while the page stays open.
  const [other] = (await testDb.select().from(matches).where(eq(matches.tournamentId, tournament.id))).filter(
    (x) => x.phase === "main" && x.status === "open",
  );
  expect(await confirmMatch(testDb, moderator.userId, other!.id, { score1: 1, score2: 0 })).toMatchObject({ ok: true });
  await expect(page.getByRole("link", { name: "Ir a tu partida" })).toBeVisible(LIVE);
});

test("a player outside the match gets the not-found page", async ({ browser }) => {
  const page = await pageAs(browser, outsider.storageState);
  const response = await page.goto(`/partidas/${matchId}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText("No encontramos esa partida.")).toBeVisible();
});

test("a chat message from one captain reaches the other", async ({ browser }) => {
  const a = await pageAs(browser, alfa.captain.storageState);
  const b = await pageAs(browser, beta.captain.storageState);
  await a.goto(`/partidas/${matchId}`);
  await b.goto(`/partidas/${matchId}`);
  await a.waitForLoadState("networkidle");
  await a.getByPlaceholder("Mensaje").fill("buen partido, gg");
  await a.getByRole("button", { name: "Enviar" }).click();
  await expect(a.getByText("buen partido, gg")).toBeVisible();
  await expect(b.getByText("buen partido, gg")).toBeVisible(LIVE);
});
