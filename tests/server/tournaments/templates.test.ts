import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, tournaments } from "../../../src/server/db/schema";
import { createDueEditions } from "../../../src/server/jobs/create-editions";
import { createTemplate, getTemplate, listTemplates, updateTemplate } from "../../../src/server/tournaments/templates";
import { updateTournament } from "../../../src/server/tournaments/tournaments";
import { baseTemplateInput, baseTournamentInput } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

const wednesday = new Date("2026-10-21T15:00:00Z");

beforeEach(async () => {
  await resetTestDb();
  await createTestUser("admin");
});

test("createTemplate stores the input and audits it", async () => {
  const { id } = await createTemplate(testDb, "admin", baseTemplateInput);
  expect(await getTemplate(testDb, id)).toMatchObject({ ...baseTemplateInput, createdBy: "admin" });
  const [audit] = await testDb.select().from(auditLog).where(eq(auditLog.action, "template.created"));
  expect(audit).toMatchObject({ actorUserId: "admin", entityId: id });
});

test("editing an edition leaves the template unchanged", async () => {
  const { id } = await createTemplate(testDb, "admin", baseTemplateInput);
  await createDueEditions(testDb, wednesday);
  const [edition] = await testDb.select().from(tournaments);
  const result = await updateTournament(testDb, "admin", edition!.id, {
    ...baseTournamentInput,
    title: "Copa Especial",
    edition: 13,
    startsAt: edition!.startsAt,
    registrationClosesAt: edition!.registrationClosesAt,
    entryFeeArs: 9000,
  });
  expect(result).toEqual({ ok: true });
  expect(await getTemplate(testDb, id)).toMatchObject({ title: "Copa Semanal LAS", entryFeeArs: 5000 });
});

test("editing the template leaves existing editions unchanged", async () => {
  const { id } = await createTemplate(testDb, "admin", baseTemplateInput);
  await createDueEditions(testDb, wednesday);
  expect(await updateTemplate(testDb, "admin", id, { ...baseTemplateInput, entryFeeArs: 9000, title: "Copa Nueva" })).toEqual({ ok: true });
  const [edition] = await testDb.select().from(tournaments);
  expect(edition).toMatchObject({ title: "Copa Semanal LAS", entryFeeArs: 5000 });
  expect(await getTemplate(testDb, id)).toMatchObject({ title: "Copa Nueva", entryFeeArs: 9000 });
  const [audit] = await testDb.select().from(auditLog).where(eq(auditLog.action, "template.updated"));
  expect(audit!.data).toMatchObject({ before: { entryFeeArs: 5000 }, after: { entryFeeArs: 9000 } });
});

test("updateTemplate on an unknown id is not_found", async () => {
  expect(await updateTemplate(testDb, "admin", crypto.randomUUID(), baseTemplateInput)).toEqual({ ok: false, reason: "not_found" });
});

test("listTemplates shows the latest edition and the next one", async () => {
  await createTemplate(testDb, "admin", baseTemplateInput);
  await createTemplate(testDb, "admin", { ...baseTemplateInput, title: "Copa Pausada", active: false });
  let [first, paused] = await listTemplates(testDb, wednesday);
  expect(first).toMatchObject({ title: "Copa Semanal LAS", latest: null });
  expect(first!.next?.startsAt).toEqual(new Date("2026-10-24T21:00:00Z"));
  expect(paused).toMatchObject({ title: "Copa Pausada", next: null, latest: null });

  await createDueEditions(testDb, wednesday);
  [first] = await listTemplates(testDb, wednesday);
  expect(first!.latest).toMatchObject({ slug: "copa-semanal-las-13", edition: 13, status: "registration_open" });
  expect(first!.next?.startsAt).toEqual(new Date("2026-10-31T21:00:00Z"));
});
