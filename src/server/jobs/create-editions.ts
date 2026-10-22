import { and, eq, inArray, max, sql } from "drizzle-orm";
import { slugify } from "../../shared/slug";
import { editionInput, planNextEdition } from "../../shared/templates";
import { tournamentInputSchema } from "../../shared/tournament";
import { writeAudit } from "../audit";
import { type Db, uniqueViolation } from "../db/client";
import { tournamentTemplates, tournaments } from "../db/schema";
import { uniqueTournamentSlug } from "../tournaments/tournaments";

const UPCOMING = ["registration_open", "registration_closed", "check_in"] as const;

/**
 * Creates each active template's next edition, already open for registration, when it is due. Safe to
 * run concurrently and repeatedly: the template row is locked, and (template, start) is unique.
 */
export async function createDueEditions(db: Db, now: Date): Promise<{ created: number }> {
  let created = 0;
  const active = await db
    .select({ id: tournamentTemplates.id })
    .from(tournamentTemplates)
    .where(eq(tournamentTemplates.active, true))
    .orderBy(tournamentTemplates.createdAt);
  for (const { id } of active) {
    // One failing template must not hold up the others.
    try {
      if (await createDueEdition(db, id, now)) created++;
    } catch (error) {
      if (uniqueViolation(error) === "tournaments_template_starts_at_idx") continue;
      console.error(`[jobs] create-editions: template ${id} failed`, error);
    }
  }
  return { created };
}

async function createDueEdition(db: Db, templateId: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [template] = await tx
      .select()
      .from(tournamentTemplates)
      .where(eq(tournamentTemplates.id, templateId))
      .for("update");
    if (!template?.active) return false;
    // Cancelled editions count too, so a cancelled week is not created again.
    const [{ latest } = { latest: null }] = await tx
      .select({ latest: max(tournaments.startsAt) })
      .from(tournaments)
      .where(eq(tournaments.templateId, templateId));
    const [upcoming] = await tx
      .select({ id: tournaments.id })
      .from(tournaments)
      .where(and(eq(tournaments.templateId, templateId), inArray(tournaments.status, [...UPCOMING])))
      .limit(1);
    const plan = planNextEdition(template, latest ? new Date(latest) : null, !!upcoming, now);
    if (!plan) return false;
    // A template row no admin form could produce fails here instead of creating a broken edition.
    const input = tournamentInputSchema.parse(editionInput(template, plan, template.nextEdition));
    const slug = await uniqueTournamentSlug(tx, `${slugify(input.title)}-${input.edition}`);
    const [row] = await tx
      .insert(tournaments)
      .values({ ...input, slug, status: "registration_open", templateId, createdBy: template.createdBy })
      .returning({ id: tournaments.id });
    await tx
      .update(tournamentTemplates)
      .set({ nextEdition: sql`${tournamentTemplates.nextEdition} + 1` })
      .where(eq(tournamentTemplates.id, templateId));
    await writeAudit(tx, {
      actorUserId: null,
      action: "tournament.created_from_template",
      entityType: "tournament",
      entityId: row!.id,
      data: { templateId, slug, edition: input.edition },
    });
    return true;
  });
}
