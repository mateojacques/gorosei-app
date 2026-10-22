import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

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

async function teamDeps() {
  const [{ db }, teams] = await Promise.all([import("../db/client"), import("./teams")]);
  return { db, teams };
}

async function hasRiotAccount(userId: string): Promise<boolean> {
  const [{ db }, { riotAccounts }] = await Promise.all([import("../db/client"), import("../db/schema")]);
  const [row] = await db.select({ id: riotAccounts.id }).from(riotAccounts).where(eq(riotAccounts.userId, userId));
  return !!row;
}

export const getTeamPage = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const { db, teams } = await teamDeps();
    const team = await teams.getTeamBySlug(db, data.slug);
    if (!team) throw notFound();
    const { configuredSiteOrigin } = await import("../seo/origin");
    const [history, origin] = await Promise.all([teams.getTeamHistory(db, team.id), configuredSiteOrigin()]);

    const user = await sessionUser();
    if (!user) return { team, history, origin, viewer: null, pendingRequests: [] };
    const role = team.members.find((m) => m.userId === user.id)?.role ?? null;
    const own = await teams.listPendingRequestsForUser(db, user.id);
    const viewer = {
      userId: user.id,
      role,
      linked: await hasRiotAccount(user.id),
      // The viewer's own pending request or invite with this team, so the page offers to answer it instead of asking again.
      joinRequestId: own.requests.find((r) => r.teamId === team.id)?.id ?? null,
      inviteId: own.invites.find((r) => r.teamId === team.id)?.id ?? null,
    };
    const pendingRequests = role === "captain" ? await teams.listPendingRequestsForTeam(db, team.id) : [];
    return { team, history, origin, viewer, pendingRequests };
  });

export const getMyTeams = createServerFn({ method: "GET" }).handler(async () => {
  const user = await sessionUser();
  if (!user) return { signedIn: false as const };
  const { db, teams } = await teamDeps();
  const [myTeams, pending] = await Promise.all([
    teams.listTeamsForUser(db, user.id),
    teams.listPendingRequestsForUser(db, user.id),
  ]);
  return { signedIn: true as const, teams: myTeams, invites: pending.invites, requests: pending.requests };
});

export const createTeamFn = createServerFn({ method: "POST" })
  .validator(z.object({ name: z.string().max(64), tag: z.string().max(16) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, teams } = await teamDeps();
    return teams.createTeam(db, user.id, data);
  });

export const inviteByRiotIdFn = createServerFn({ method: "POST" })
  .validator(z.object({ teamId: z.uuid(), riotId: z.string().max(64) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, teams } = await teamDeps();
    return teams.inviteByRiotId(db, user.id, data.teamId, data.riotId);
  });

export const requestToJoinFn = createServerFn({ method: "POST" })
  .validator(z.object({ teamId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, teams } = await teamDeps();
    return teams.requestToJoin(db, user.id, data.teamId);
  });

export const respondToRequestFn = createServerFn({ method: "POST" })
  .validator(z.object({ requestId: z.uuid(), accept: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, teams } = await teamDeps();
    return teams.respondToRequest(db, user.id, data.requestId, data.accept);
  });

export const cancelRequestFn = createServerFn({ method: "POST" })
  .validator(z.object({ requestId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, teams } = await teamDeps();
    return teams.cancelRequest(db, user.id, data.requestId);
  });

export const leaveTeamFn = createServerFn({ method: "POST" })
  .validator(z.object({ teamId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, teams } = await teamDeps();
    return teams.leaveTeam(db, user.id, data.teamId);
  });

export const removeMemberFn = createServerFn({ method: "POST" })
  .validator(z.object({ teamId: z.uuid(), userId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, teams } = await teamDeps();
    return teams.removeMember(db, user.id, data.teamId, data.userId);
  });

export const transferCaptainFn = createServerFn({ method: "POST" })
  .validator(z.object({ teamId: z.uuid(), userId: z.string() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, teams } = await teamDeps();
    return teams.transferCaptain(db, user.id, data.teamId, data.userId);
  });
