import { asc, desc, eq, inArray, like, or } from "drizzle-orm";
import { slugify } from "../../shared/slug";
import type { TournamentInput } from "../../shared/tournament";
import { writeAudit } from "../audit";
import type { Db } from "../db/client";
import { tournaments } from "../db/schema";

export type Tournament = typeof tournaments.$inferSelect;

async function uniqueSlug(db: Db, base: string): Promise<string> {
  const rows = await db
    .select({ slug: tournaments.slug })
    .from(tournaments)
    .where(or(eq(tournaments.slug, base), like(tournaments.slug, `${base}-%`)));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

export async function createTournament(
  db: Db,
  actorUserId: string,
  input: TournamentInput,
): Promise<{ id: string; slug: string }> {
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(tx as unknown as Db, `${slugify(input.title)}-${input.edition}`);
    const [row] = await tx
      .insert(tournaments)
      .values({ ...input, slug, createdBy: actorUserId })
      .returning({ id: tournaments.id, slug: tournaments.slug });
    await writeAudit(tx, {
      actorUserId,
      action: "tournament.created",
      entityType: "tournament",
      entityId: row!.id,
      data: { slug },
    });
    return row!;
  });
}

export async function updateTournament(
  db: Db,
  actorUserId: string,
  id: string,
  input: TournamentInput,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_editable" }> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(tournaments).where(eq(tournaments.id, id)).for("update");
    if (!current) return { ok: false, reason: "not_found" } as const;
    if (current.status === "finished" || current.status === "cancelled") {
      return { ok: false, reason: "not_editable" } as const;
    }
    await tx.update(tournaments).set({ ...input, updatedAt: new Date() }).where(eq(tournaments.id, id));
    await writeAudit(tx, {
      actorUserId,
      action: "tournament.updated",
      entityType: "tournament",
      entityId: id,
      data: { before: current, after: input },
    });
    return { ok: true } as const;
  });
}

export async function openRegistration(
  db: Db,
  actorUserId: string,
  id: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" | "invalid_state" }> {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(tournaments).where(eq(tournaments.id, id)).for("update");
    if (!current) return { ok: false, reason: "not_found" } as const;
    if (current.status !== "draft") return { ok: false, reason: "invalid_state" } as const;
    await tx
      .update(tournaments)
      .set({ status: "registration_open", updatedAt: new Date() })
      .where(eq(tournaments.id, id));
    await writeAudit(tx, {
      actorUserId,
      action: "tournament.registration_opened",
      entityType: "tournament",
      entityId: id,
    });
    return { ok: true } as const;
  });
}

export async function getTournamentBySlug(db: Db, slug: string): Promise<Tournament | null> {
  const [row] = await db.select().from(tournaments).where(eq(tournaments.slug, slug));
  return row ?? null;
}

export async function getTournamentById(db: Db, id: string): Promise<Tournament | null> {
  const [row] = await db.select().from(tournaments).where(eq(tournaments.id, id));
  return row ?? null;
}

export async function listTournaments(db: Db): Promise<Tournament[]> {
  return db.select().from(tournaments).orderBy(desc(tournaments.startsAt));
}

export async function getFeaturedTournament(db: Db): Promise<Tournament | null> {
  const [open] = await db
    .select()
    .from(tournaments)
    .where(eq(tournaments.status, "registration_open"))
    .orderBy(asc(tournaments.startsAt))
    .limit(1);
  if (open) return open;
  const [active] = await db
    .select()
    .from(tournaments)
    .where(inArray(tournaments.status, ["registration_closed", "check_in", "live"]))
    .orderBy(asc(tournaments.startsAt))
    .limit(1);
  return active ?? null;
}
