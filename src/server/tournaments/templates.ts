import { asc, desc, eq } from "drizzle-orm";
import { type EditionPlan, planNextEdition, type TemplateInput } from "../../shared/templates";
import type { TournamentStatus } from "../../shared/tournament";
import { writeAudit } from "../audit";
import type { Db } from "../db/client";
import { tournamentTemplates, tournaments } from "../db/schema";

export type Template = typeof tournamentTemplates.$inferSelect;

export async function createTemplate(db: Db, adminId: string, input: TemplateInput): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(tournamentTemplates)
      .values({ ...input, createdBy: adminId })
      .returning({ id: tournamentTemplates.id });
    await writeAudit(tx, { actorUserId: adminId, action: "template.created", entityType: "template", entityId: row!.id });
    return row!;
  });
}

/** Changes the template only; editions already created keep their own copy. */
export async function updateTemplate(
  db: Db,
  adminId: string,
  id: string,
  input: TemplateInput,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(tournamentTemplates).where(eq(tournamentTemplates.id, id)).for("update");
    if (!current) return { ok: false, reason: "not_found" } as const;
    await tx
      .update(tournamentTemplates)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(tournamentTemplates.id, id));
    await writeAudit(tx, {
      actorUserId: adminId,
      action: "template.updated",
      entityType: "template",
      entityId: id,
      data: { before: current, after: input },
    });
    return { ok: true } as const;
  });
}

export async function getTemplate(db: Db, id: string): Promise<Template | null> {
  const [row] = await db.select().from(tournamentTemplates).where(eq(tournamentTemplates.id, id));
  return row ?? null;
}

export type TemplateRow = Template & {
  next: EditionPlan | null;
  latest: { id: string; slug: string; edition: number; status: TournamentStatus } | null;
};

/** `next` is the edition the job will create next (ignoring when), null while the template is paused. */
export async function listTemplates(db: Db, now: Date): Promise<TemplateRow[]> {
  const templates = await db.select().from(tournamentTemplates).orderBy(asc(tournamentTemplates.createdAt));
  return Promise.all(
    templates.map(async (template) => {
      const [latest] = await db
        .select({ id: tournaments.id, slug: tournaments.slug, edition: tournaments.edition, status: tournaments.status, startsAt: tournaments.startsAt })
        .from(tournaments)
        .where(eq(tournaments.templateId, template.id))
        .orderBy(desc(tournaments.startsAt))
        .limit(1);
      return {
        ...template,
        next: template.active ? planNextEdition(template, latest?.startsAt ?? null, false, now) : null,
        latest: latest ? { id: latest.id, slug: latest.slug, edition: latest.edition, status: latest.status } : null,
      };
    }),
  );
}
