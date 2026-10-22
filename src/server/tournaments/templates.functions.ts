import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { templateInputSchema, type TemplateInput } from "../../shared/templates";
import { requireAdmin } from "./admin.functions";

// Server-only modules are imported inside handlers so they never reach the client bundle.
async function deps() {
  const [{ db }, templates] = await Promise.all([import("../db/client"), import("./templates")]);
  return { db, templates };
}

type InvalidInput = { ok: false; reason: "invalid_input"; issues: { path: string; message: string }[] };

function parseInput(input: unknown): { ok: true; data: TemplateInput } | InvalidInput {
  const parsed = templateInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    reason: "invalid_input",
    issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

export const listTemplatesFn = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { db, templates } = await deps();
  const rows = await templates.listTemplates(db, new Date());
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    weekday: row.weekday,
    startTime: row.startTime,
    active: row.active,
    nextEdition: row.nextEdition,
    nextStartsAt: row.next?.startsAt ?? null,
    latest: row.latest,
  }));
});

export const getTemplateFn = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { db, templates } = await deps();
    const template = await templates.getTemplate(db, data.id);
    if (!template) throw notFound();
    return template;
  });

export const createTemplateFn = createServerFn({ method: "POST" })
  .validator(z.object({ input: z.unknown() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const parsed = parseInput(data.input);
    if (!parsed.ok) return parsed;
    const { db, templates } = await deps();
    const created = await templates.createTemplate(db, admin.id, parsed.data);
    return { ok: true as const, ...created };
  });

export const updateTemplateFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid(), input: z.unknown() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const parsed = parseInput(data.input);
    if (!parsed.ok) return parsed;
    const { db, templates } = await deps();
    return templates.updateTemplate(db, admin.id, data.id, parsed.data);
  });
