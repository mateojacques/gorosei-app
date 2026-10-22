import { type Browser, expect, test } from "@playwright/test";
import { teamMembers } from "../src/server/db/schema";
import { createTeam } from "../src/server/teams/teams";
import { createTestTournament } from "../tests/helpers/competition";
import { resetTestDb, testDb } from "../tests/helpers/db";
import { type StorageState, createPlayer } from "./helpers/players";

test.use({ javaScriptEnabled: true });
// The team registered in one test is what the next ones look at.
test.describe.configure({ mode: "serial" });

const PAID_SLUG = "copa-semanal-las-1";
const FREE_SLUG = "copa-gratis-1";
const PAYMENT_INSTRUCTIONS = "Transferí al alias gorosei.copa";

let captain: StorageState;
let masterCaptain: StorageState;
const teammates = ["Uno", "Dos", "Tres", "Cuatro"];

async function addMembers(teamId: string, userIds: string[]) {
  await testDb.insert(teamMembers).values(userIds.map((userId) => ({ teamId, userId, role: "member" as const })));
}

test.beforeAll(async () => {
  await resetTestDb();
  const maxDiamond = [{ id: "r1", type: "player_rank_range" as const, max: { tier: "DIAMOND" as const, division: "IV" as const } }];
  await createTestTournament({
    title: "Copa Semanal LAS",
    edition: 1,
    status: "registration_open",
    teamCap: 16,
    prizeGoalArs: 300000,
    entryFeeArs: 5000,
    eligibilityRules: maxDiamond,
    paymentInstructions: PAYMENT_INSTRUCTIONS,
  });
  await createTestTournament({
    title: "Copa Gratis",
    edition: 1,
    status: "registration_open",
    entryFeeArs: 0,
    eligibilityRules: maxDiamond,
    paymentInstructions: PAYMENT_INSTRUCTIONS,
  });

  const gold = { tier: "GOLD" as const, division: "II" as const, lp: 0 };
  const cap = await createPlayer({
    name: "Capi",
    email: "capi@test.local",
    riot: { gameName: "Capi", tagLine: "LAS", rank: gold },
  });
  captain = cap.storageState;
  const mates: string[] = [];
  for (const name of teammates) {
    const p = await createPlayer({ name, email: `${name.toLowerCase()}@test.local`, riot: { gameName: name, tagLine: "LAS", rank: gold } });
    mates.push(p.userId);
  }
  const team = await createTeam(testDb, cap.userId, { name: "Los Pibes", tag: "PBS" });
  if (!team.ok) throw new Error(team.reason);
  await addMembers(team.teamId, mates);

  const mc = await createPlayer({
    name: "Otro Capi",
    email: "otrocapi@test.local",
    riot: { gameName: "Otro Capi", tagLine: "LAS", rank: gold },
  });
  masterCaptain = mc.storageState;
  const master = await createPlayer({
    name: "Faker",
    email: "faker@test.local",
    riot: { gameName: "Faker", tagLine: "LAS", rank: { tier: "MASTER", division: "I", lp: 300 } },
  });
  const masterTeam = await createTeam(testDb, mc.userId, { name: "Los Altos", tag: "ALT" });
  if (!masterTeam.ok) throw new Error(masterTeam.reason);
  await addMembers(masterTeam.teamId, [master.userId]);
});

async function pageAs(browser: Browser, storageState: StorageState) {
  const context = await browser.newContext({ storageState, javaScriptEnabled: true, baseURL: "http://localhost:3100" });
  return context.newPage();
}

async function registerAll(browser: Browser, slug: string, team: string, players: string[]) {
  const page = await pageAs(browser, captain);
  await page.goto(`/torneos/${slug}/inscribir`);
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Equipo").selectOption({ label: team });
  for (const player of players) await page.getByRole("checkbox", { name: `${player}#LAS titular` }).check();
  await page.getByRole("button", { name: "Inscribir equipo" }).click();
  return page;
}

test("the tournament page is readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL: "http://localhost:3100" });
  const page = await context.newPage();
  const res = await page.goto(`/torneos/${PAID_SLUG}`);
  const html = await res!.text();
  expect(html).toContain("Copa Semanal LAS");
  expect(html).toContain("$300.000");
  expect(html).toContain("el pozo es el premio");
  expect(html).toContain("Rango máximo por jugador: Diamante IV");
  expect(html).toContain("confirmados 0/16");
});

test("a captain registers five teammates and the team waits for payments", async ({ browser }) => {
  const page = await registerAll(browser, PAID_SLUG, "Los Pibes", ["Capi", ...teammates]);
  await expect(page).toHaveURL(new RegExp(`/torneos/${PAID_SLUG}/equipos/los-pibes$`));
  await expect(page.getByText("0/5 pagos")).toBeVisible();
  await expect(page.getByText("El equipo está inscripto y espera los pagos")).toBeVisible();

  await page.goto(`/torneos/${PAID_SLUG}`);
  await expect(page.getByRole("table", { name: "Equipos inscriptos" })).toContainText("Los Pibes");
  await expect(page.getByRole("table", { name: "Equipos inscriptos" })).toContainText("Pendiente");
});

test("a roster with a player above the max rank is rejected with the reason", async ({ browser }) => {
  const page = await pageAs(browser, masterCaptain);
  await page.goto(`/torneos/${PAID_SLUG}/inscribir`);
  await page.waitForLoadState("networkidle");
  await page.getByRole("checkbox", { name: "Faker#LAS titular" }).check();
  await page.getByRole("button", { name: "Inscribir equipo" }).click();
  await expect(page.getByRole("alert")).toContainText("Faker#LAS tiene Maestro y el máximo permitido es Diamante IV.");
});

test("a free tournament confirms a full eligible roster with no payment step", async ({ browser }) => {
  const page = await registerAll(browser, FREE_SLUG, "Los Pibes", ["Capi", ...teammates]);
  await expect(page).toHaveURL(new RegExp(`/torneos/${FREE_SLUG}/equipos/los-pibes$`));
  await expect(page.getByText("El equipo está confirmado")).toBeVisible();

  const res = await page.request.get(`/torneos/${FREE_SLUG}`);
  const html = await res.text();
  expect(html).toContain("Los Pibes");
  expect(html).not.toContain("pagos");
  expect(html).not.toContain(PAYMENT_INSTRUCTIONS);
});
