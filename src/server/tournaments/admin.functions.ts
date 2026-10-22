import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { tournamentInputSchema } from "../../shared/tournament";

// Server-only modules are imported inside handlers so they never reach the client bundle.
// Anyone who isn't an admin gets the ordinary not-found page: the admin area never admits it exists.
async function requireAdmin() {
  const { getSessionUser } = await import("../auth");
  const user = await getSessionUser(getRequestHeaders());
  if (!user || user.role !== "admin") throw notFound();
  return user;
}

async function deps() {
  const [{ db }, tournaments, credits, registrations] = await Promise.all([
    import("../db/client"),
    import("./tournaments"),
    import("./credits"),
    import("./registrations"),
  ]);
  return { db, tournaments, credits, registrations };
}

type InvalidInput = { ok: false; reason: "invalid_input"; issues: { path: string; message: string }[] };

function parseInput(input: unknown): { ok: true; data: z.infer<typeof tournamentInputSchema> } | InvalidInput {
  const parsed = tournamentInputSchema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  return {
    ok: false,
    reason: "invalid_input",
    issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
}

export const adminGate = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  return { ok: true as const };
});

export const listAdminTournaments = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const { db, tournaments, registrations } = await deps();
  const all = await tournaments.listTournaments(db);
  return Promise.all(
    all.map(async (t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      edition: t.edition,
      startsAt: t.startsAt,
      status: t.status,
      teamCap: t.teamCap,
      confirmedCount: (await registrations.listRegistrations(db, t.id)).filter((r) => r.status === "confirmed").length,
    })),
  );
});

export const getAdminTournament = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { db, tournaments } = await deps();
    const tournament = await tournaments.getTournamentById(db, data.id);
    if (!tournament) throw notFound();
    return tournament;
  });

export const createTournamentFn = createServerFn({ method: "POST" })
  .validator(z.object({ input: z.unknown() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const parsed = parseInput(data.input);
    if (!parsed.ok) return parsed;
    const { db, tournaments } = await deps();
    const created = await tournaments.createTournament(db, admin.id, parsed.data);
    return { ok: true as const, ...created };
  });

export const updateTournamentFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid(), input: z.unknown() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const parsed = parseInput(data.input);
    if (!parsed.ok) return parsed;
    const { db, tournaments } = await deps();
    return tournaments.updateTournament(db, admin.id, data.id, parsed.data);
  });

export const openRegistrationFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, tournaments } = await deps();
    return tournaments.openRegistration(db, admin.id, data.id);
  });

export const closeRegistrationFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, credits } = await deps();
    return credits.closeRegistration(db, data.id, new Date(), admin.id);
  });

export const cancelTournamentFn = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.uuid(), reason: z.string().trim().min(1).max(500) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, credits } = await deps();
    return credits.cancelTournament(db, admin.id, data.id, data.reason);
  });
