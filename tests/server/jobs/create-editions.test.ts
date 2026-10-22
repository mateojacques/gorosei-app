import { beforeEach, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { auditLog, tournamentTemplates, tournaments } from "../../../src/server/db/schema";
import { createDueEditions } from "../../../src/server/jobs/create-editions";
import { createTemplate } from "../../../src/server/tournaments/templates";
import { baseTemplateInput } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

const wednesday = new Date("2026-10-21T15:00:00Z");
const editions = () => testDb.select().from(tournaments).orderBy(asc(tournaments.startsAt));

beforeEach(async () => {
  await resetTestDb();
  await createTestUser("admin");
});

test("creates the first edition open for registration, copying the template", async () => {
  const { id } = await createTemplate(testDb, "admin", baseTemplateInput);
  expect(await createDueEditions(testDb, wednesday)).toEqual({ created: 1 });
  const [edition] = await editions();
  expect(edition).toMatchObject({
    status: "registration_open",
    edition: 13,
    slug: "copa-semanal-las-13",
    templateId: id,
    title: "Copa Semanal LAS",
    startsAt: new Date("2026-10-24T21:00:00Z"),
    registrationClosesAt: new Date("2026-10-24T19:00:00Z"),
    bracket: "double_elimination",
    draftMode: "tournament_draft",
    bestOf: 1,
    finalsBestOf: 3,
    teamCap: 16,
    maxSubs: 1,
    subsCountForTeamRules: false,
    rankSource: "peak_season",
    eligibilityRules: baseTemplateInput.eligibilityRules,
    entryFeeArs: 5000,
    prizeGoalArs: 300000,
    prizeSplit: [70, 30],
    paymentInstructions: "Mercado Pago a gorosei",
    rulesText: "Reglas",
    streamUrl: "https://twitch.tv/gorosei",
    createdBy: "admin",
  });
  const [audit] = await testDb.select().from(auditLog).where(eq(auditLog.action, "tournament.created_from_template"));
  expect(audit).toMatchObject({ actorUserId: null, entityId: edition!.id });
  const [template] = await testDb.select().from(tournamentTemplates);
  expect(template!.nextEdition).toBe(14);
});

test("running again creates nothing", async () => {
  await createTemplate(testDb, "admin", baseTemplateInput);
  await createDueEditions(testDb, wednesday);
  expect(await createDueEditions(testDb, wednesday)).toEqual({ created: 0 });
  expect(await editions()).toHaveLength(1);
});

test("two concurrent runs create one edition", async () => {
  await createTemplate(testDb, "admin", baseTemplateInput);
  await Promise.all([createDueEditions(testDb, wednesday), createDueEditions(testDb, wednesday)]);
  expect(await editions()).toHaveLength(1);
});

test("an inactive template creates nothing", async () => {
  await createTemplate(testDb, "admin", { ...baseTemplateInput, active: false });
  expect(await createDueEditions(testDb, wednesday)).toEqual({ created: 0 });
});

test("the next edition waits for its registration window", async () => {
  await createTemplate(testDb, "admin", baseTemplateInput);
  await createDueEditions(testDb, wednesday);
  expect(await createDueEditions(testDb, new Date("2026-10-24T20:59:00Z"))).toEqual({ created: 0 });
  expect(await createDueEditions(testDb, new Date("2026-10-24T21:00:00Z"))).toEqual({ created: 1 });
  const all = await editions();
  expect(all.map((e) => [e.edition, e.startsAt.toISOString()])).toEqual([
    [13, "2026-10-24T21:00:00.000Z"],
    [14, "2026-10-31T21:00:00.000Z"],
  ]);
});

test("after three weeks down, one edition in the future", async () => {
  await createTemplate(testDb, "admin", baseTemplateInput);
  await createDueEditions(testDb, new Date("2026-09-30T15:00:00Z"));
  await testDb.update(tournaments).set({ status: "finished" });
  const now = new Date("2026-10-24T15:00:00Z");
  expect(await createDueEditions(testDb, now)).toEqual({ created: 1 });
  const all = await editions();
  expect(all).toHaveLength(2);
  expect(all[1]!.startsAt).toEqual(new Date("2026-10-24T21:00:00Z"));
  expect(all[1]!.edition).toBe(14);
});

test("a cancelled edition is replaced by the next week at once", async () => {
  await createTemplate(testDb, "admin", baseTemplateInput);
  await createDueEditions(testDb, wednesday);
  await testDb.update(tournaments).set({ status: "cancelled" });
  expect(await createDueEditions(testDb, wednesday)).toEqual({ created: 1 });
  expect((await editions()).map((e) => e.startsAt.toISOString())).toEqual([
    "2026-10-24T21:00:00.000Z",
    "2026-10-31T21:00:00.000Z",
  ]);
});

test("a broken template does not stop another", async () => {
  await createTemplate(testDb, "admin", { ...baseTemplateInput, title: "Copa Rota" });
  // A row no admin form could produce: the split does not sum to 100.
  await testDb.update(tournamentTemplates).set({ prizeSplit: [50] });
  await createTemplate(testDb, "admin", { ...baseTemplateInput, title: "Copa Sana" });
  expect(await createDueEditions(testDb, wednesday)).toEqual({ created: 1 });
  expect((await editions()).map((e) => e.title)).toEqual(["Copa Sana"]);
});
