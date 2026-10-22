import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { isModerator, reportInputSchema } from "../../shared/match";

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

/** Moderators and admins only; anyone else gets the ordinary not-found page. */
async function requireModerator() {
  const user = await sessionUser();
  if (!user || !isModerator(user.role)) throw notFound();
  return user;
}

async function deps() {
  const [{ db }, { riot }, check, reports, moderation, chat, stats, bracket, schema, orm] = await Promise.all([
    import("../db/client"),
    import("../riot"),
    import("./check-in"),
    import("./reports"),
    import("./moderation"),
    import("./chat"),
    import("./stats"),
    import("../bracket/bracket"),
    import("../db/schema"),
    import("drizzle-orm"),
  ]);
  return { db, riot, check, reports, moderation, chat, stats, bracket, schema, orm };
}

const id = z.uuid();

// ---- Check-in ----

export const checkInFn = createServerFn({ method: "POST" })
  .validator(z.object({ registrationId: id }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, check } = await deps();
    return check.checkIn(db, user.id, data.registrationId, new Date());
  });

export const decideShortHandedFn = createServerFn({ method: "POST" })
  .validator(z.object({ registrationId: id, decision: z.enum(["play", "withdraw"]) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, check } = await deps();
    return check.decideShortHanded(db, user.id, data.registrationId, data.decision, new Date());
  });

/** The signed-in player's check-in view (while check-in runs) or current match (while live) for a tournament. */
export const getCheckInPanel = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const user = await sessionUser();
    if (!user) return null;
    const { db, check, schema, orm } = await deps();
    const { and, eq, inArray, asc } = orm;
    const [tournament] = await db.select().from(schema.tournaments).where(eq(schema.tournaments.slug, data.slug));
    if (!tournament || (tournament.status !== "check_in" && tournament.status !== "live")) return null;
    const [row] = await db
      .select({ registrationId: schema.registrations.id, captainUserId: schema.teams.captainUserId, teamName: schema.teams.name })
      .from(schema.registrationPlayers)
      .innerJoin(schema.registrations, eq(schema.registrations.id, schema.registrationPlayers.registrationId))
      .innerJoin(schema.teams, eq(schema.teams.id, schema.registrations.teamId))
      .where(
        and(
          eq(schema.registrationPlayers.tournamentId, tournament.id),
          eq(schema.registrationPlayers.userId, user.id),
          eq(schema.registrationPlayers.active, true),
          eq(schema.registrations.status, "confirmed"),
        ),
      );
    if (!row) return null;
    if (tournament.status === "check_in") {
      const view = await check.getCheckInView(db, row.registrationId, new Date());
      return view ? { kind: "check_in" as const, view, userId: user.id, isCaptain: row.captainUserId === user.id, teamName: row.teamName } : null;
    }
    const { or } = orm;
    const [match] = await db
      .select({ id: schema.matches.id })
      .from(schema.matches)
      .where(
        and(
          eq(schema.matches.tournamentId, tournament.id),
          or(eq(schema.matches.reg1Id, row.registrationId), eq(schema.matches.reg2Id, row.registrationId)),
          inArray(schema.matches.status, ["open", "in_progress", "reported", "disputed"]),
        ),
      )
      .orderBy(asc(schema.matches.roundNo));
    return { kind: "live" as const, matchId: match?.id ?? null, teamName: row.teamName };
  });

// ---- Match page ----

async function matchPage(matchId: string, user: { id: string; role: "player" | "moderator" | "admin" } | null) {
  const [{ db }, { loadMatchPage }] = await Promise.all([import("../db/client"), import("./match-page")]);
  const page = await loadMatchPage(db, matchId, user ? { userId: user.id, role: user.role } : null, new Date());
  if (!page) throw notFound();
  return page;
}

export const getMatchPage = createServerFn({ method: "GET" })
  .validator(z.object({ matchId: id }))
  .handler(async ({ data }) => {
    // Public: signed-out visitors get the match without lobby, reports or chat.
    return matchPage(data.matchId, await sessionUser());
  });

export const getConsolePage = createServerFn({ method: "GET" })
  .validator(z.object({ matchId: id.optional() }))
  .handler(async ({ data }) => {
    const user = await requireModerator();
    const { db, bracket } = await deps();
    const queue = await bracket.getConsoleQueue(db, new Date());
    const selected = data.matchId ? await matchPage(data.matchId, user).catch(() => null) : null;
    return { queue, selected };
  });

// ---- Match actions ----

export const postLobbyFn = createServerFn({ method: "POST" })
  .validator(z.object({ matchId: id, name: z.string().trim().min(1).max(60), password: z.string().trim().min(1).max(60) }))
  .handler(async ({ data }) => {
    const user = await requireModerator();
    const { db, reports } = await deps();
    return reports.postLobby(db, user.id, data.matchId, { name: data.name, password: data.password });
  });

export const reportResultFn = createServerFn({ method: "POST" })
  .validator(z.object({ matchId: id, report: reportInputSchema }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, reports } = await deps();
    return reports.reportResult(db, user.id, data.matchId, data.report);
  });

const score = z.object({ score1: z.number().int().min(0).max(3), score2: z.number().int().min(0).max(3) });

export const confirmMatchFn = createServerFn({ method: "POST" })
  .validator(z.object({ matchId: id, result: score.optional() }))
  .handler(async ({ data }) => {
    const user = await requireModerator();
    const { db, moderation } = await deps();
    return moderation.confirmMatch(db, user.id, data.matchId, data.result);
  });

export const forfeitMatchFn = createServerFn({ method: "POST" })
  .validator(z.object({ matchId: id, registrationId: id }))
  .handler(async ({ data }) => {
    const user = await requireModerator();
    const { db, moderation } = await deps();
    return moderation.forfeitMatch(db, user.id, data.matchId, data.registrationId);
  });

export const resetMatchFn = createServerFn({ method: "POST" })
  .validator(z.object({ matchId: id }))
  .handler(async ({ data }) => {
    const user = await requireModerator();
    const { db, moderation } = await deps();
    return moderation.resetMatch(db, user.id, data.matchId);
  });

export const swapPlayerFn = createServerFn({ method: "POST" })
  .validator(z.object({ registrationId: id, outUserId: z.string().min(1), inUserId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const user = await requireModerator();
    const { db, riot, moderation } = await deps();
    return moderation.swapPlayer({ db, riot }, user.id, data.registrationId, data.outUserId, data.inUserId);
  });

export const setMatchVodFn = createServerFn({ method: "POST" })
  .validator(z.object({ matchId: id, url: z.string().max(2000).nullable() }))
  .handler(async ({ data }) => {
    const user = await requireModerator();
    const { db, moderation } = await deps();
    return moderation.setMatchVod(db, user.id, data.matchId, data.url === "" ? null : data.url);
  });

// ---- Chat and stats ----

export const postMessageFn = createServerFn({ method: "POST" })
  .validator(z.object({ matchId: id, body: z.string().max(5000) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, chat } = await deps();
    return chat.postMessage(db, user, data.matchId, data.body);
  });

export const listMessagesFn = createServerFn({ method: "GET" })
  .validator(z.object({ matchId: id }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, chat } = await deps();
    return chat.listMessages(db, user, data.matchId);
  });

export const attachRiotMatchIdsFn = createServerFn({ method: "POST" })
  .validator(z.object({ matchId: id, riotMatchIds: z.array(z.string()).min(1).max(3) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, riot, stats } = await deps();
    return stats.attachRiotMatchIds({ db, riot }, user, data.matchId, data.riotMatchIds);
  });
