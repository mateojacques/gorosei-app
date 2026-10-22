import { type Browser, type Page, expect, test } from "@playwright/test";
import { and, eq } from "drizzle-orm";
import { auditLog } from "../src/server/db/schema";
import { createTestRegistration, createTestTeam, createTestTournament, linkedPlayer } from "../tests/helpers/competition";
import { resetTestDb, testDb } from "../tests/helpers/db";
import { type StorageState, createPlayer } from "./helpers/players";

test.use({ javaScriptEnabled: true });
test.describe.configure({ mode: "serial" });

const gold = { tier: "GOLD" as const, division: "II" as const, lp: 0 };
const teamA = ["Alfa1", "Alfa2", "Alfa3", "Alfa4", "Alfa5"];
const teamB = ["Beta1", "Beta2", "Beta3", "Beta4", "Beta5"];

let admin: StorageState;
let tournamentId: string;
let tournamentSlug: string;

test.beforeAll(async () => {
  await resetTestDb();
  admin = (await createPlayer({ name: "Admin", email: "admin@test.local", role: "admin" })).storageState;
  const tournament = await createTestTournament({ title: "Copa Chica", edition: 1, status: "registration_open", teamCap: 1 });
  tournamentId = tournament.id;
  tournamentSlug = tournament.slug;
  for (const [name, players] of [
    ["Equipo Alfa", teamA],
    ["Equipo Beta", teamB],
  ] as const) {
    for (const id of players) await linkedPlayer(id, gold);
    const team = await createTestTeam(players[0]!, players.slice(1), name);
    await createTestRegistration(tournament.id, team.id, { starters: [...players], subs: [] });
  }
});

async function adminPage(browser: Browser) {
  const context = await browser.newContext({ storageState: admin, javaScriptEnabled: true, baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  await page.goto(`/admin/torneos/${tournamentId}`);
  await page.waitForLoadState("networkidle");
  return page;
}

async function markPaid(page: Page, team: string, players: string[], reference: string) {
  const section = page.getByRole("region", { name: team });
  for (const player of players) await section.getByRole("checkbox", { name: `Seleccionar ${player}#LAS` }).check();
  await section.getByLabel("Referencia de pago").fill(reference);
  await section.getByRole("button", { name: "Marcar pagado" }).click();
}

test("marking five players paid confirms the team within the cap", async ({ browser }) => {
  const page = await adminPage(browser);
  await markPaid(page, "Equipo Alfa", teamA, "MP-123");
  await expect(page.getByRole("region", { name: "Equipo Alfa" })).toContainText("Confirmado");

  const html = await (await page.request.get(`/torneos/${tournamentSlug}`)).text();
  expect(html).toContain("confirmados 1/1");
});

test("a second team that qualifies with the cap full is waitlisted", async ({ browser }) => {
  const page = await adminPage(browser);
  await markPaid(page, "Equipo Beta", teamB.slice(0, 4), "MP-200");
  await expect(page.getByRole("region", { name: "Equipo Beta" })).toContainText("4/5 pagos");
  await markPaid(page, "Equipo Beta", teamB.slice(4), "MP-201");
  await expect(page.getByRole("region", { name: "Equipo Beta" })).toContainText("En espera");
});

test("closing drops the waitlisted team and credits its players", async ({ browser }) => {
  const page = await adminPage(browser);
  await page.getByRole("button", { name: "Cerrar inscripción ahora" }).click();
  await expect(page.getByRole("region", { name: "Equipo Beta" })).toContainText("Afuera");

  const panel = page.getByRole("region", { name: "Buscar jugador" });
  for (const player of teamB) {
    await panel.getByLabel("Riot ID").fill(`${player}#LAS`);
    await panel.getByRole("button", { name: "Buscar" }).click();
    await expect(panel.getByText(`${player}#LAS`).first()).toBeVisible();
    await expect(panel.getByText("1 crédito disponible")).toBeVisible();
  }
});

test("setting a rank override writes an audit row", async ({ browser }) => {
  const page = await adminPage(browser);
  const panel = page.getByRole("region", { name: "Buscar jugador" });
  await panel.getByLabel("Riot ID").fill("Alfa1#LAS");
  await panel.getByRole("button", { name: "Buscar" }).click();
  await panel.getByLabel("Rango forzado", { exact: true }).selectOption("PLATINUM");
  await panel.getByLabel("División").selectOption("II");
  await panel.getByLabel("Motivo del rango forzado").fill("Cuenta nueva de un jugador conocido");
  await panel.getByRole("button", { name: "Forzar rango" }).click();
  await expect(panel.getByText("Platino II")).toBeVisible();

  const rows = await testDb.select().from(auditLog).where(and(eq(auditLog.action, "rank.override_set")));
  expect(rows).toHaveLength(1);
});
