import { type Browser, expect, test } from "@playwright/test";
import { enterPool } from "../src/server/pool/pool";
import { createTestRegistration, createTestTeam, createTestTournament, payFor } from "../tests/helpers/competition";
import type { Rank } from "../src/shared/rank";
import { resetTestDb, testDb } from "../tests/helpers/db";
import { FakeRiotClient } from "../tests/helpers/fake-riot";
import { type StorageState, createPlayer } from "./helpers/players";

test.use({ javaScriptEnabled: true });
test.describe.configure({ mode: "serial" });

const gold: Rank = { tier: "GOLD", division: "II", lp: 0 };
const BASE_URL = "http://localhost:3100";

async function pageAs(browser: Browser, storageState: StorageState) {
  const context = await browser.newContext({ storageState, javaScriptEnabled: true, baseURL: BASE_URL });
  return context.newPage();
}

async function player(name: string, rank: Rank = gold) {
  const created = await createPlayer({
    name,
    email: `${name.toLowerCase().replace(/\s+/g, "")}@test.local`,
    riot: { gameName: name, tagLine: "LAS", rank },
  });
  return created;
}

const enter = (tournamentId: string, userId: string, roles: ("top" | "jungle" | "mid" | "bot" | "support")[]) =>
  enterPool({ db: testDb, riot: new FakeRiotClient() }, userId, tournamentId, { roles, autoPlace: true });

test.describe("the pool page", () => {
  let tournament: Awaited<ReturnType<typeof createTestTournament>>;
  let unpaid: Awaited<ReturnType<typeof player>>;
  let newcomer: Awaited<ReturnType<typeof player>>;
  let captain: Awaited<ReturnType<typeof player>>;
  let captain2: Awaited<ReturnType<typeof player>>;
  let guest: Awaited<ReturnType<typeof player>>;
  let faker: Awaited<ReturnType<typeof player>>;

  test.beforeAll(async () => {
    await resetTestDb();
    tournament = await createTestTournament({
      title: "Copa Pool",
      edition: 1,
      status: "registration_open",
      entryFeeArs: 5000,
      paymentInstructions: "Transferí al alias gorosei.copa",
      eligibilityRules: [{ id: "r1", type: "max_players_above", count: 0, above: { tier: "EMERALD", division: "I" } }],
    });

    // Team A: four starters, captain "Capi".
    captain = await player("Capi");
    const mates = [];
    for (const name of ["Uno", "Dos", "Tres"]) mates.push(await player(name));
    const teamA = await createTestTeam(captain.userId, mates.map((m) => m.userId), "Los Pibes");
    await createTestRegistration(tournament.id, teamA.id, { starters: [captain.userId, ...mates.map((m) => m.userId)], subs: [] });

    // Team B: three starters, captain "Capi Dos"; it recruits.
    captain2 = await player("Capi Dos");
    const mates2 = [await player("Cinco"), await player("Seis")];
    const teamB = await createTestTeam(captain2.userId, mates2.map((m) => m.userId), "Los Altos");
    await createTestRegistration(tournament.id, teamB.id, { starters: [captain2.userId, ...mates2.map((m) => m.userId)], subs: [] });

    // Three paid pool players for the public count.
    newcomer = await player("Nuevo");
    guest = await player("Invitado");
    const third = await player("Tercero");
    for (const p of [newcomer, guest, third]) await payFor(tournament.id, p.userId);
    await enter(tournament.id, guest.userId, ["jungle", "top"]);
    await enter(tournament.id, third.userId, ["support"]);
    faker = await player("Faker", { tier: "MASTER", division: "I", lp: 300 });
    await payFor(tournament.id, faker.userId);
    await enter(tournament.id, faker.userId, ["jungle"]);
    unpaid = await player("Sin Pago");
  });

  test("the tournament page shows the pool count and the link without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: BASE_URL });
    const page = await context.newPage();
    const res = await page.goto(`/torneos/${tournament.slug}`);
    const html = await res!.text();
    expect(html).toContain("3 agentes libres");
    expect(html).toContain("Buscar equipo");
    expect(html).toContain(`/torneos/${tournament.slug}/agentes-libres`);
  });

  test("an unpaid player sees how to pay and no role picker", async ({ browser }) => {
    const page = await pageAs(browser, unpaid.storageState);
    await page.goto(`/torneos/${tournament.slug}/agentes-libres`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByText("Transferí al alias gorosei.copa")).toBeVisible();
    await expect(page.getByText("Primero, pagá tu inscripción")).toBeVisible();
    await expect(page.getByRole("button", { name: /Mid/ })).toHaveCount(0);
  });

  test("a paid player enters with ordered roles and sees a team missing a player", async ({ browser }) => {
    const page = await pageAs(browser, newcomer.storageState);
    await page.goto(`/torneos/${tournament.slug}/agentes-libres`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Mid: sin elegir" }).click();
    await page.getByRole("button", { name: "Top: sin elegir" }).click();
    await expect(page.getByRole("button", { name: "Mid: preferencia 1" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Top: preferencia 2" })).toBeVisible();
    await page.getByRole("button", { name: "Entrar al pool" }).click();
    await expect(page.getByText("Estás en el pool.")).toBeVisible();
    await expect(page.getByRole("table", { name: "Equipos que buscan jugadores" })).toContainText("Los Pibes");
  });

  test("hand-pick: the player requests a team and the captain accepts", async ({ browser }) => {
    const agent = await pageAs(browser, newcomer.storageState);
    await agent.goto(`/torneos/${tournament.slug}/agentes-libres`);
    await agent.waitForLoadState("networkidle");
    await agent.getByRole("row", { name: /Los Pibes/ }).getByRole("button", { name: "Pedir unirme" }).click();
    await expect(agent.getByRole("table", { name: "Tus solicitudes" })).toContainText("Los Pibes");

    const cap = await pageAs(browser, captain.storageState);
    await cap.goto("/equipos/los-pibes");
    await cap.waitForLoadState("networkidle");
    await cap.getByRole("row", { name: /Nuevo#LAS/ }).getByRole("button", { name: "Aceptar" }).click();
    await expect(cap.getByRole("table", { name: "Roster" })).toContainText("Nuevo#LAS");

    await agent.reload();
    await expect(agent.getByText("Ya tenés equipo")).toBeVisible();
  });

  test("recruit: a captain filters the pool by role, invites, and the player accepts", async ({ browser }) => {
    const cap = await pageAs(browser, captain2.storageState);
    await cap.goto(`/torneos/${tournament.slug}/agentes-libres`);
    await cap.waitForLoadState("networkidle");
    await cap.getByLabel("Rol").selectOption("jungle");
    await cap.getByRole("button", { name: "Filtrar" }).click();
    await expect(cap).toHaveURL(/role=jungle/);
    await cap.waitForLoadState("networkidle");
    const table = cap.getByRole("table", { name: "Agentes libres disponibles" });
    await expect(table).toContainText("Invitado#LAS");
    await expect(table).not.toContainText("Tercero#LAS");

    // a MASTER would break the team's rules: the invite is refused with the reason
    await cap.getByRole("row", { name: /Faker#LAS/ }).getByRole("button", { name: "Invitar" }).click();
    await expect(cap.getByRole("alert")).toBeVisible();

    await cap.getByRole("row", { name: /Invitado#LAS/ }).getByRole("button", { name: "Invitar" }).click();
    await expect(cap.getByText("Invitación enviada.")).toBeVisible();

    const agent = await pageAs(browser, guest.storageState);
    await agent.goto(`/torneos/${tournament.slug}/agentes-libres`);
    await agent.waitForLoadState("networkidle");
    await agent.getByRole("row", { name: /Los Altos/ }).getByRole("button", { name: "Aceptar" }).click();
    await expect(agent.getByText("Ya tenés equipo")).toBeVisible();
  });

  test("the pool page has no horizontal scroll at 320px", async ({ browser }) => {
    const page = await pageAs(browser, faker.storageState);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/torneos/${tournament.slug}/agentes-libres`);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  });
});

test.describe("admin pool tools", () => {
  let admin: StorageState;
  let tournament: Awaited<ReturnType<typeof createTestTournament>>;
  let agents: Awaited<ReturnType<typeof player>>[] = [];

  test.beforeAll(async () => {
    await resetTestDb();
    admin = (await createPlayer({ name: "Admin", email: "admin@test.local", role: "admin" })).storageState;
    tournament = await createTestTournament({ title: "Copa Armada", edition: 1, status: "registration_open", entryFeeArs: 5000 });
    agents = [];
    for (let i = 1; i <= 10; i++) {
      const agent = await player(`Agente ${String.fromCharCode(64 + i)}`);
      await payFor(tournament.id, agent.userId);
      await enter(tournament.id, agent.userId, [(["top", "jungle", "mid", "bot", "support"] as const)[i % 5]!]);
      agents.push(agent);
    }
  });

  test("an admin sees the pool, previews the teams, closes registration, and captains keep their team", async ({ browser }) => {
    const page = await pageAs(browser, admin);
    await page.goto(`/admin/torneos/${tournament.id}`);
    await page.waitForLoadState("networkidle");
    const table = page.getByRole("table", { name: "Agentes libres" });
    await expect(table.getByRole("row")).toHaveCount(11);

    await page.getByRole("button", { name: "Vista previa del armado" }).click();
    await expect(page.getByText(/Equipo 2: capitán/)).toBeVisible();

    await page.getByRole("button", { name: "Cerrar inscripción ahora" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Inscripción cerrada:" })).toBeVisible();

    const html = await (await page.request.get(`/torneos/${tournament.slug}`)).text();
    expect(html).toContain("Agentes libres 1");
    expect(html).toContain("confirmados 2/16");

    // a pool player now sees their team and teammates
    const agent = await pageAs(browser, agents[0]!.storageState);
    await agent.goto(`/torneos/${tournament.slug}/agentes-libres`);
    await agent.waitForLoadState("networkidle");
    await expect(agent.getByText("Ya tenés equipo")).toBeVisible();
    await expect(agent.getByText(/Con vos:/)).toBeVisible();

    // the highest-ranked, earliest-joined player captains the auto-formed team and keeps it by renaming it
    await agent.getByRole("link", { name: /Agentes libres/ }).first().click();
    await agent.waitForLoadState("networkidle");
    await agent.getByLabel("Nombre del equipo").fill("Los Libres");
    await agent.getByLabel("Tag").fill("LIB");
    await agent.getByRole("button", { name: "Quedarse con el equipo" }).click();
    await expect(agent.getByRole("heading", { name: "Los Libres" })).toBeVisible();
    const after = await (await agent.request.get(`/torneos/${tournament.slug}`)).text();
    expect(after).toContain("Los Libres");
  });

  test("a non-admin still gets the not-found page on the admin route", async ({ browser }) => {
    const page = await pageAs(browser, agents[0]!.storageState);
    const res = await page.goto(`/admin/torneos/${tournament.id}`);
    expect(res!.status()).toBe(404);
  });
});
