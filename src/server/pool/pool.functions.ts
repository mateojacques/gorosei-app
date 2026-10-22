import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { poolEntryInputSchema, ROLES } from "../../shared/pool";
import { TIERS } from "../../shared/rank";

// Server-only modules are imported inside handlers so they never reach the client bundle.
async function sessionUser() {
  const { getSessionUser } = await import("../auth");
  return getSessionUser(getRequestHeaders());
}

async function requireUser() {
  const user = await sessionUser();
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

async function requireAdmin() {
  const { requireAdmin: check } = await import("../tournaments/admin.functions");
  return check();
}

async function deps() {
  const [{ db }, { riot }, pool, requests, view, autoPlace, teams] = await Promise.all([
    import("../db/client"),
    import("../riot"),
    import("./pool"),
    import("./requests"),
    import("./pool-view"),
    import("./auto-place"),
    import("../teams/teams"),
  ]);
  return { db, riot, pool, requests, view, autoPlace, teams };
}

const filterInput = z.object({
  role: z.enum(ROLES).optional(),
  minTier: z.enum(TIERS).optional(),
  maxTier: z.enum(TIERS).optional(),
});
export type PoolSearch = z.infer<typeof filterInput>;

export const getPoolPageFn = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string(), filter: filterInput.optional() }))
  .handler(async ({ data }) => {
    const { db, view } = await deps();
    const user = await sessionUser();
    const filter = {
      role: data.filter?.role,
      // Tier-wide bounds: from the lowest division of the min tier up to the highest of the max tier.
      minRank: data.filter?.minTier ? { tier: data.filter.minTier, division: "IV" as const, lp: 0 } : undefined,
      maxRank: data.filter?.maxTier ? { tier: data.filter.maxTier, division: "I" as const, lp: 100 } : undefined,
    };
    const page = await view.getPoolPage(db, data.slug, user?.id ?? null, filter);
    if (!page) throw notFound();
    return page;
  });

export const enterPoolFn = createServerFn({ method: "POST" })
  .validator(z.object({ tournamentId: z.uuid(), entry: poolEntryInputSchema }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, riot, pool } = await deps();
    return pool.enterPool({ db, riot }, user.id, data.tournamentId, data.entry);
  });

export const leavePoolFn = createServerFn({ method: "POST" })
  .validator(z.object({ tournamentId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, pool } = await deps();
    return pool.leavePool(db, user.id, data.tournamentId);
  });

export const requestFromPoolFn = createServerFn({ method: "POST" })
  .validator(z.object({ registrationId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, requests } = await deps();
    return requests.requestFromPool(db, user.id, data.registrationId);
  });

export const recruitFromPoolFn = createServerFn({ method: "POST" })
  .validator(z.object({ registrationId: z.uuid(), userId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, requests } = await deps();
    return requests.recruitFromPool(db, user.id, data.registrationId, data.userId);
  });

export const respondToPoolRequestFn = createServerFn({ method: "POST" })
  .validator(z.object({ requestId: z.uuid(), accept: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, riot, requests } = await deps();
    return requests.respondToPoolRequest({ db, riot }, user.id, data.requestId, data.accept);
  });

export const renameTeamFn = createServerFn({ method: "POST" })
  .validator(z.object({ teamId: z.uuid(), name: z.string().max(64), tag: z.string().max(16) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, teams } = await deps();
    return teams.renameTeam(db, user.id, data.teamId, { name: data.name, tag: data.tag });
  });

// Admin tools (Task 7)
export const getAdminPoolFn = createServerFn({ method: "GET" })
  .validator(z.object({ tournamentId: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { db, pool } = await deps();
    return pool.listPoolForAdmin(db, data.tournamentId);
  });

export const removeFromPoolFn = createServerFn({ method: "POST" })
  .validator(z.object({ tournamentId: z.uuid(), userId: z.string(), reason: z.string().min(1).max(500) }))
  .handler(async ({ data }) => {
    const admin = await requireAdmin();
    const { db, pool } = await deps();
    return pool.removeFromPool(db, admin.id, data.tournamentId, data.userId, data.reason);
  });

export const previewPlacementFn = createServerFn({ method: "GET" })
  .validator(z.object({ tournamentId: z.uuid() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { db, autoPlace } = await deps();
    const { tournaments } = await import("../db/schema");
    const { eq } = await import("drizzle-orm");
    const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, data.tournamentId));
    if (!tournament) throw notFound();
    const plan = await autoPlace.planPoolPlacement(db, tournament, new Date());
    return {
      teams: plan.plan.teams.map((team) => ({
        captain: plan.riotIds.get(team.captainUserId) ?? team.captainUserId,
        members: team.members.map((m) => ({ riotId: plan.riotIds.get(m.userId) ?? m.userId, role: m.role })),
      })),
      unplaced: plan.plan.unplacedUserIds.map((id) => plan.riotIds.get(id) ?? id),
      failing: plan.failing,
    };
  });
