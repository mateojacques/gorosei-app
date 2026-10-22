import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { DIVISIONS, TIERS } from "../../shared/rank";
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

async function adminDeps() {
  const [base, confirmations, ranks, schema, { and, eq, inArray, sql }] = await Promise.all([
    deps(),
    import("./confirmations"),
    import("../identity/ranks"),
    import("../db/schema"),
    import("drizzle-orm"),
  ]);
  return { ...base, confirmations, ranks, schema, and, eq, inArray, sql };
}

export const getAdminRegistrations = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { db, registrations, schema, and, eq, inArray, sql } = await adminDeps();
    const views = await registrations.listRegistrations(db, data.id);
    const userIds = [...new Set(views.flatMap((v) => v.roster.map((p) => p.userId)))];
    const counts =
      userIds.length === 0
        ? []
        : await db
            .select({ userId: schema.entryCredits.userId, count: sql<number>`count(*)::int` })
            .from(schema.entryCredits)
            .where(and(inArray(schema.entryCredits.userId, userIds), eq(schema.entryCredits.status, "available")))
            .groupBy(schema.entryCredits.userId);
    const available = new Map(counts.map((c) => [c.userId, c.count]));
    return views.map((view) => ({
      ...view,
      roster: view.roster.map((p) => ({ ...p, availableCredits: available.get(p.userId) ?? 0 })),
    }));
  });

export const markPaidFn = createServerFn({ method: "POST" })
  .validator(z.object({ tournamentId: z.uuid(), userIds: z.array(z.string()).min(1).max(10), reference: z.string().trim().min(1).max(200) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, confirmations } = await adminDeps();
    return confirmations.markPaid(db, admin.id, data.tournamentId, data.userIds, data.reference);
  });

export const unmarkPaidFn = createServerFn({ method: "POST" })
  .validator(z.object({ tournamentId: z.uuid(), userId: z.string() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, confirmations } = await adminDeps();
    return confirmations.unmarkPaid(db, admin.id, data.tournamentId, data.userId);
  });

/** Pays a player's entry with their oldest available credit. */
export const useCreditFn = createServerFn({ method: "POST" })
  .validator(z.object({ tournamentId: z.uuid(), userId: z.string() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, credits } = await adminDeps();
    const credit = (await credits.listCreditsForUser(db, data.userId))
      .filter((c) => c.status === "available")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!credit) return { ok: false as const, reason: "credit_unavailable" as const };
    return credits.applyCredit(db, admin.id, credit.id, data.tournamentId);
  });

export const grantExceptionFn = createServerFn({ method: "POST" })
  .validator(z.object({ tournamentId: z.uuid(), teamId: z.uuid(), ruleId: z.string().max(40), reason: z.string().trim().min(1).max(500) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, confirmations } = await adminDeps();
    return confirmations.grantEligibilityException(db, admin.id, data);
  });

export const forceRemoveFn = createServerFn({ method: "POST" })
  .validator(z.object({ registrationId: z.uuid(), reason: z.string().trim().min(1).max(500) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, confirmations } = await adminDeps();
    return confirmations.forceRemoveRegistration(db, admin.id, data.registrationId, data.reason);
  });

export const findPlayerFn = createServerFn({ method: "POST" })
  .validator(z.object({ riotId: z.string().max(64) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { db, credits, schema, and, eq, sql } = await adminDeps();
    const { parseRiotId } = await import("../../shared/riot-id");
    const riotId = parseRiotId(data.riotId);
    if (!riotId) return null;
    const [account] = await db
      .select()
      .from(schema.riotAccounts)
      .where(
        and(
          sql`lower(${schema.riotAccounts.gameName}) = lower(${riotId.gameName})`,
          sql`lower(${schema.riotAccounts.tagLine}) = lower(${riotId.tagLine})`,
        ),
      );
    if (!account) return null;
    const [override] = await db.select().from(schema.rankOverrides).where(eq(schema.rankOverrides.riotAccountId, account.id));
    return {
      userId: account.userId,
      riotAccountId: account.id,
      gameName: account.gameName,
      tagLine: account.tagLine,
      override: override ? { tier: override.tier, division: override.division, reason: override.reason } : null,
      credits: await credits.listCreditsForUser(db, account.userId),
    };
  });

export const grantManualCreditFn = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string(), note: z.string().trim().min(1).max(500) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, credits } = await adminDeps();
    return credits.grantManualCredit(db, admin.id, data.userId, data.note);
  });

export const revokeCreditFn = createServerFn({ method: "POST" })
  .validator(z.object({ creditId: z.uuid() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, credits } = await adminDeps();
    return credits.revokeCredit(db, admin.id, data.creditId);
  });

export const setRankOverrideFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      riotAccountId: z.uuid(),
      tier: z.enum(TIERS),
      division: z.enum(DIVISIONS),
      reason: z.string().trim().min(1).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, ranks } = await adminDeps();
    await ranks.setRankOverride(db, admin.id, data.riotAccountId, { tier: data.tier, division: data.division }, data.reason);
    return { ok: true as const };
  });

export const clearRankOverrideFn = createServerFn({ method: "POST" })
  .validator(z.object({ riotAccountId: z.uuid() }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, ranks } = await adminDeps();
    await ranks.clearRankOverride(db, admin.id, data.riotAccountId);
    return { ok: true as const };
  });
