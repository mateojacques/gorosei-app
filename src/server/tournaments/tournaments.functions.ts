import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { formatRiotId } from "../../shared/riot-id";

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

async function deps() {
  const [{ db }, { riot }, registrations, view, teams] = await Promise.all([
    import("../db/client"),
    import("../riot"),
    import("./registrations"),
    import("./tournament-view"),
    import("../teams/teams"),
  ]);
  return { db, riot, registrations, view, teams };
}

export type PickerMember = { userId: string; riotId: string };

const rosterInput = z.object({ starters: z.array(z.string()).max(10), subs: z.array(z.string()).max(10) });

export const getTournamentPage = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const { db, view } = await deps();
    const tournament = await view.getTournamentView(db, data.slug);
    if (!tournament) throw notFound();
    return tournament;
  });

export const getRegisterPage = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const { db, view, registrations, teams } = await deps();
    const tournament = await view.getTournamentView(db, data.slug);
    if (!tournament) throw notFound();
    const summary = { id: tournament.id, slug: tournament.slug, title: tournament.title, edition: tournament.edition, status: tournament.status, maxSubs: tournament.maxSubs };
    const user = await sessionUser();
    if (!user) return { tournament: summary, signedIn: false as const, teams: [] };

    const registered = new Set(
      (await registrations.listRegistrations(db, tournament.id))
        .filter((r) => r.status !== "withdrawn" && r.status !== "dropped")
        .map((r) => r.team.id),
    );
    const captained = (await teams.listTeamsForUser(db, user.id)).filter((t) => t.role === "captain" && !registered.has(t.id));
    const withMembers = await Promise.all(
      captained.map(async (t) => {
        const team = await teams.getTeamBySlug(db, t.slug);
        const members: PickerMember[] = (team?.members ?? []).map((m) => ({ userId: m.userId, riotId: formatRiotId(m) }));
        return { id: t.id, slug: t.slug, name: t.name, members };
      }),
    );
    return { tournament: summary, signedIn: true as const, teams: withMembers };
  });

export const getRegistrationPage = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string(), teamSlug: z.string() }))
  .handler(async ({ data }) => {
    const { db, view, registrations, teams } = await deps();
    const tournament = await view.getTournamentView(db, data.slug);
    if (!tournament) throw notFound();
    const registration = await registrations.getRegistrationForTeam(db, tournament.id, data.teamSlug);
    if (!registration) throw notFound();

    const user = await sessionUser();
    const isCaptain = user?.id === registration.team.captainUserId;
    // Only the captain edits the roster, so only the captain gets the team's member list.
    const team = isCaptain ? await teams.getTeamBySlug(db, registration.team.slug) : null;
    const members: PickerMember[] = (team?.members ?? []).map((m) => ({ userId: m.userId, riotId: formatRiotId(m) }));
    return {
      tournament: {
        slug: tournament.slug,
        title: tournament.title,
        edition: tournament.edition,
        status: tournament.status,
        entryFeeArs: tournament.entryFeeArs,
        maxSubs: tournament.maxSubs,
      },
      registration,
      isCaptain,
      members,
    };
  });

export const registerTeamFn = createServerFn({ method: "POST" })
  .validator(z.object({ tournamentId: z.uuid(), teamId: z.uuid(), roster: rosterInput }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, riot, registrations } = await deps();
    return registrations.registerTeam({ db, riot }, user.id, data.tournamentId, data.teamId, data.roster);
  });

export const updateRosterFn = createServerFn({ method: "POST" })
  .validator(z.object({ registrationId: z.uuid(), roster: rosterInput }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, riot, registrations } = await deps();
    return registrations.updateRoster({ db, riot }, user.id, data.registrationId, data.roster);
  });

export const withdrawRegistrationFn = createServerFn({ method: "POST" })
  .validator(z.object({ registrationId: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, registrations } = await deps();
    return registrations.withdrawRegistration(db, user.id, data.registrationId);
  });
