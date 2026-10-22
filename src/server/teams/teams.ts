import { and, asc, desc, eq, inArray, like, ne, notInArray, or, sql } from "drizzle-orm";
import type { Rank } from "../../shared/rank";
import { parseRiotId } from "../../shared/riot-id";
import { slugify } from "../../shared/slug";
import { writeAudit } from "../audit";
import { uniqueViolation } from "../db/client";
import type { Db, Executor } from "../db/client";
import {
  registrationPlayers,
  registrations,
  riotAccounts,
  teamMembers,
  teamRequests,
  teams,
  tournaments,
} from "../db/schema";
import { getCurrentRank } from "../identity/ranks";
import { lockTournament, recomputeConfirmations } from "../tournaments/confirmations";
import { placementsFor } from "../tournaments/results";
import type { TournamentStatus } from "../../shared/tournament";

export type TeamRequest = {
  id: string;
  teamId: string;
  userId: string;
  kind: "invite" | "join_request";
  tournamentId: string | null;
  status: "pending" | "accepted" | "declined" | "cancelled";
};

export type TeamView = {
  id: string;
  slug: string;
  name: string;
  tag: string;
  captainUserId: string;
  /** Formed by auto-placement and not yet kept by its captain (renamed). */
  autoFormed: boolean;
  members: { userId: string; gameName: string; tagLine: string; role: "captain" | "member"; currentRank: Rank | null }[];
};

const NAME_MIN = 3;
const NAME_MAX = 24;
const TAG_PATTERN = /^[A-Z0-9]{2,5}$/;

const codePoints = (s: string) => [...s].length;

// Static routes under /equipos win over /equipos/$slug, so a team can never own these slugs.
const RESERVED_SLUGS = new Set(["nuevo"]);

async function uniqueTeamSlug(db: Executor, base: string): Promise<string> {
  const rows = await db
    .select({ slug: teams.slug })
    .from(teams)
    .where(or(eq(teams.slug, base), like(teams.slug, `${base}-%`)));
  const taken = new Set([...RESERVED_SLUGS, ...rows.map((r) => r.slug)]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

async function hasRiotAccount(db: Executor, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: riotAccounts.id }).from(riotAccounts).where(eq(riotAccounts.userId, userId));
  return !!row;
}

async function lockTeam(db: Executor, teamId: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).for("update");
  return team;
}

async function isMember(db: Executor, teamId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
  return !!row;
}

async function hasPendingRequest(db: Executor, teamId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: teamRequests.id })
    .from(teamRequests)
    .where(and(eq(teamRequests.teamId, teamId), eq(teamRequests.userId, userId), eq(teamRequests.status, "pending")));
  return !!row;
}

/**
 * A player on a confirmed roster can't leave until the captain replaces them; otherwise they are
 * dropped from the team's unconfirmed (pending or waitlisted) rosters. Tournaments that are over hold no one.
 */
async function releaseFromRosters(tx: Executor, teamId: string, userId: string): Promise<"on_confirmed_roster" | string[]> {
  const rosterRows = () =>
    tx
      .select({ registrationId: registrations.id, tournamentId: registrations.tournamentId, status: registrations.status })
      .from(registrationPlayers)
      .innerJoin(registrations, eq(registrations.id, registrationPlayers.registrationId))
      .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
      .where(
        and(
          eq(registrations.teamId, teamId),
          eq(registrationPlayers.userId, userId),
          eq(registrationPlayers.active, true),
          notInArray(tournaments.status, ["finished", "cancelled"]),
        ),
      );
  // Statuses change under the tournament lock, so lock the tournaments (in a stable order) before reading them.
  const tournamentIds = [...new Set((await rosterRows()).map((r) => r.tournamentId))].sort();
  for (const id of tournamentIds) await lockTournament(tx, id);
  const rows = await rosterRows();
  if (rows.some((r) => r.status === "confirmed")) return "on_confirmed_roster";
  const registrationIds = rows.map((r) => r.registrationId);
  if (registrationIds.length > 0) {
    await tx
      .delete(registrationPlayers)
      .where(and(inArray(registrationPlayers.registrationId, registrationIds), eq(registrationPlayers.userId, userId)));
  }
  for (const id of tournamentIds) await recomputeConfirmations(tx, id, new Date());
  return registrationIds;
}

type TeamNameRejection = "invalid_name" | "invalid_tag" | "name_taken" | "tag_taken";

/** Trims and checks the name and tag, returning the normalized values or the reason they are invalid. */
function validateTeamName(input: { name: string; tag: string }): { name: string; tag: string } | TeamNameRejection {
  const name = input.name.trim();
  const tag = input.tag.trim().toUpperCase();
  if (codePoints(name) < NAME_MIN || codePoints(name) > NAME_MAX) return "invalid_name";
  if (!TAG_PATTERN.test(tag)) return "invalid_tag";
  return { name, tag };
}

/** The first name or tag clash with a team other than `exceptTeamId`. */
async function nameClash(tx: Executor, name: string, tag: string, exceptTeamId?: string): Promise<"name_taken" | "tag_taken" | null> {
  const others = exceptTeamId ? ne(teams.id, exceptTeamId) : undefined;
  const [sameName] = await tx.select({ id: teams.id }).from(teams).where(and(sql`lower(${teams.name}) = lower(${name})`, others));
  if (sameName) return "name_taken";
  const [sameTag] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.tag, tag), others));
  return sameTag ? "tag_taken" : null;
}

/** Inserts the team and its captain membership; the caller has validated the name and tag. */
export async function createTeamRow(
  tx: Executor,
  input: { name: string; tag: string; captainUserId: string; autoFormedTournamentId?: string },
): Promise<{ id: string; slug: string }> {
  const slug = await uniqueTeamSlug(tx, slugify(input.name) || "equipo");
  const [team] = await tx
    .insert(teams)
    .values({
      slug,
      name: input.name,
      tag: input.tag,
      captainUserId: input.captainUserId,
      autoFormedTournamentId: input.autoFormedTournamentId ?? null,
    })
    .returning({ id: teams.id });
  await tx.insert(teamMembers).values({ teamId: team!.id, userId: input.captainUserId, role: "captain" });
  return { id: team!.id, slug };
}

function rejectNameConflict(error: unknown): { ok: false; reason: "tag_taken" | "name_taken" } {
  // Two writers racing for the same name or tag: the unique indexes are the final arbiter.
  const constraint = uniqueViolation(error);
  if (constraint === "teams_tag_unique") return { ok: false, reason: "tag_taken" };
  if (constraint === "teams_name_lower_idx") return { ok: false, reason: "name_taken" };
  throw error;
}

export async function createTeam(
  db: Db,
  userId: string,
  input: { name: string; tag: string },
): Promise<
  | { ok: true; teamId: string; slug: string }
  | { ok: false; reason: "riot_required" | "invalid_name" | "invalid_tag" | "name_taken" | "tag_taken" }
> {
  const valid = validateTeamName(input);
  if (typeof valid === "string") return { ok: false, reason: valid };
  const { name, tag } = valid;

  try {
    return await db.transaction(async (tx) => {
      if (!(await hasRiotAccount(tx, userId))) return { ok: false, reason: "riot_required" } as const;
      const clash = await nameClash(tx, name, tag);
      if (clash) return { ok: false, reason: clash } as const;

      const team = await createTeamRow(tx, { name, tag, captainUserId: userId });
      await writeAudit(tx, {
        actorUserId: userId,
        action: "team.created",
        entityType: "team",
        entityId: team.id,
        data: { name, tag, slug: team.slug },
      });
      return { ok: true, teamId: team.id, slug: team.slug } as const;
    });
  } catch (error) {
    return rejectNameConflict(error);
  }
}

/** Renaming is how a captain keeps an auto-formed team: it clears the auto-formed flag. */
export async function renameTeam(
  db: Db,
  captainId: string,
  teamId: string,
  input: { name: string; tag: string },
): Promise<{ ok: true } | { ok: false; reason: "not_captain" | TeamNameRejection }> {
  try {
    return await db.transaction(async (tx) => {
      const team = await lockTeam(tx, teamId);
      if (!team || team.captainUserId !== captainId) return { ok: false, reason: "not_captain" } as const;
      const valid = validateTeamName(input);
      if (typeof valid === "string") return { ok: false, reason: valid } as const;
      const clash = await nameClash(tx, valid.name, valid.tag, teamId);
      if (clash) return { ok: false, reason: clash } as const;
      await tx.update(teams).set({ name: valid.name, tag: valid.tag, autoFormedTournamentId: null }).where(eq(teams.id, teamId));
      await writeAudit(tx, {
        actorUserId: captainId,
        action: "team.renamed",
        entityType: "team",
        entityId: teamId,
        data: { from: { name: team.name, tag: team.tag }, to: valid, wasAutoFormed: team.autoFormedTournamentId !== null },
      });
      return { ok: true } as const;
    });
  } catch (error) {
    return rejectNameConflict(error);
  }
}

export async function inviteByRiotId(
  db: Db,
  captainId: string,
  teamId: string,
  riotIdInput: string,
): Promise<
  | { ok: true; requestId: string }
  | { ok: false; reason: "not_captain" | "invalid_riot_id" | "player_not_found" | "already_member" | "already_pending" }
> {
  return db.transaction(async (tx) => {
    const team = await lockTeam(tx, teamId);
    if (!team || team.captainUserId !== captainId) return { ok: false, reason: "not_captain" } as const;
    const riotId = parseRiotId(riotIdInput);
    if (!riotId) return { ok: false, reason: "invalid_riot_id" } as const;

    // SQL lower() folds Unicode, so "señor café#las" matches "Señor Café#LAS".
    const [account] = await tx
      .select({ userId: riotAccounts.userId })
      .from(riotAccounts)
      .where(
        and(
          sql`lower(${riotAccounts.gameName}) = lower(${riotId.gameName})`,
          sql`lower(${riotAccounts.tagLine}) = lower(${riotId.tagLine})`,
        ),
      );
    if (!account) return { ok: false, reason: "player_not_found" } as const;
    if (await isMember(tx, teamId, account.userId)) return { ok: false, reason: "already_member" } as const;
    if (await hasPendingRequest(tx, teamId, account.userId)) return { ok: false, reason: "already_pending" } as const;

    const [request] = await tx
      .insert(teamRequests)
      .values({ teamId, userId: account.userId, kind: "invite" })
      .returning({ id: teamRequests.id });
    return { ok: true, requestId: request!.id } as const;
  });
}

export async function requestToJoin(
  db: Db,
  userId: string,
  teamId: string,
): Promise<
  { ok: true; requestId: string } | { ok: false; reason: "riot_required" | "team_not_found" | "already_member" | "already_pending" }
> {
  try {
    return await db.transaction(async (tx) => {
      if (!(await hasRiotAccount(tx, userId))) return { ok: false, reason: "riot_required" } as const;
      if (!(await lockTeam(tx, teamId))) return { ok: false, reason: "team_not_found" } as const;
      if (await isMember(tx, teamId, userId)) return { ok: false, reason: "already_member" } as const;
      if (await hasPendingRequest(tx, teamId, userId)) return { ok: false, reason: "already_pending" } as const;
      const [request] = await tx
        .insert(teamRequests)
        .values({ teamId, userId, kind: "join_request" })
        .returning({ id: teamRequests.id });
      return { ok: true, requestId: request!.id } as const;
    });
  } catch (error) {
    if (uniqueViolation(error) === "team_requests_one_pending_idx") return { ok: false, reason: "already_pending" };
    throw error;
  }
}

async function lockPendingRequest(tx: Executor, requestId: string) {
  const [request] = await tx.select().from(teamRequests).where(eq(teamRequests.id, requestId)).for("update");
  return request && request.status === "pending" ? request : null;
}

export async function respondToRequest(
  db: Db,
  actorId: string,
  requestId: string,
  accept: boolean,
): Promise<{ ok: true } | { ok: false; reason: "not_allowed" | "not_pending" | "pool_request" }> {
  return db.transaction(async (tx) => {
    const request = await lockPendingRequest(tx, requestId);
    if (!request) return { ok: false, reason: "not_pending" } as const;
    // Pool requests place the player on a roster, which only respondToPoolRequest does.
    if (request.tournamentId) return { ok: false, reason: "pool_request" } as const;
    const team = await lockTeam(tx, request.teamId);
    // Invites are answered by the invited user, join requests by the captain.
    const answerer = request.kind === "invite" ? request.userId : team?.captainUserId;
    if (!team || actorId !== answerer) return { ok: false, reason: "not_allowed" } as const;

    await tx
      .update(teamRequests)
      .set({ status: accept ? "accepted" : "declined", resolvedAt: new Date() })
      .where(eq(teamRequests.id, requestId));
    if (accept && !(await isMember(tx, team.id, request.userId))) {
      await tx.insert(teamMembers).values({ teamId: team.id, userId: request.userId, role: "member" });
      await writeAudit(tx, {
        actorUserId: actorId,
        action: "team.member_joined",
        entityType: "team",
        entityId: team.id,
        data: { userId: request.userId, via: request.kind },
      });
    }
    return { ok: true } as const;
  });
}

export async function cancelRequest(
  db: Db,
  actorId: string,
  requestId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_allowed" | "not_pending" }> {
  return db.transaction(async (tx) => {
    const request = await lockPendingRequest(tx, requestId);
    if (!request) return { ok: false, reason: "not_pending" } as const;
    const team = await lockTeam(tx, request.teamId);
    // The captain cancels an invite, the requester cancels a join request.
    const canceller = request.kind === "invite" ? team?.captainUserId : request.userId;
    if (!team || actorId !== canceller) return { ok: false, reason: "not_allowed" } as const;
    await tx
      .update(teamRequests)
      .set({ status: "cancelled", resolvedAt: new Date() })
      .where(eq(teamRequests.id, requestId));
    return { ok: true } as const;
  });
}

export async function leaveTeam(
  db: Db,
  userId: string,
  teamId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_member" | "captain_must_transfer" | "on_confirmed_roster" }> {
  return db.transaction(async (tx) => {
    const team = await lockTeam(tx, teamId);
    if (!team || !(await isMember(tx, teamId, userId))) return { ok: false, reason: "not_member" } as const;
    if (team.captainUserId === userId) return { ok: false, reason: "captain_must_transfer" } as const;
    const droppedFrom = await releaseFromRosters(tx, teamId, userId);
    if (droppedFrom === "on_confirmed_roster") return { ok: false, reason: droppedFrom } as const;
    await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    await writeAudit(tx, {
      actorUserId: userId,
      action: "team.member_left",
      entityType: "team",
      entityId: teamId,
      data: { userId, droppedFrom },
    });
    return { ok: true } as const;
  });
}

export async function removeMember(
  db: Db,
  captainId: string,
  teamId: string,
  userId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_captain" | "not_member" | "on_confirmed_roster" }> {
  return db.transaction(async (tx) => {
    const team = await lockTeam(tx, teamId);
    if (!team || team.captainUserId !== captainId) return { ok: false, reason: "not_captain" } as const;
    // The captain can't be removed; they have to transfer captaincy first.
    if (userId === captainId || !(await isMember(tx, teamId, userId))) {
      return { ok: false, reason: "not_member" } as const;
    }
    const droppedFrom = await releaseFromRosters(tx, teamId, userId);
    if (droppedFrom === "on_confirmed_roster") return { ok: false, reason: droppedFrom } as const;
    await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    await writeAudit(tx, {
      actorUserId: captainId,
      action: "team.member_removed",
      entityType: "team",
      entityId: teamId,
      data: { userId, droppedFrom },
    });
    return { ok: true } as const;
  });
}

export async function transferCaptain(
  db: Db,
  captainId: string,
  teamId: string,
  newCaptainId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_captain" | "not_member" }> {
  return db.transaction(async (tx) => {
    const team = await lockTeam(tx, teamId);
    if (!team || team.captainUserId !== captainId) return { ok: false, reason: "not_captain" } as const;
    if (newCaptainId === captainId || !(await isMember(tx, teamId, newCaptainId))) {
      return { ok: false, reason: "not_member" } as const;
    }
    await tx.update(teams).set({ captainUserId: newCaptainId }).where(eq(teams.id, teamId));
    await tx
      .update(teamMembers)
      .set({ role: "member" })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, captainId)));
    await tx
      .update(teamMembers)
      .set({ role: "captain" })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, newCaptainId)));
    await writeAudit(tx, {
      actorUserId: captainId,
      action: "team.captain_transferred",
      entityType: "team",
      entityId: teamId,
      data: { from: captainId, to: newCaptainId },
    });
    return { ok: true } as const;
  });
}

export async function getTeamBySlug(db: Db, slug: string): Promise<TeamView | null> {
  const [team] = await db.select().from(teams).where(eq(teams.slug, slug));
  if (!team) return null;
  const rows = await db
    .select({
      userId: teamMembers.userId,
      role: teamMembers.role,
      riotAccountId: riotAccounts.id,
      gameName: riotAccounts.gameName,
      tagLine: riotAccounts.tagLine,
    })
    .from(teamMembers)
    .innerJoin(riotAccounts, eq(riotAccounts.userId, teamMembers.userId))
    .where(eq(teamMembers.teamId, team.id))
    .orderBy(sql`${teamMembers.role} = 'captain' desc`, asc(teamMembers.joinedAt));
  const members = await Promise.all(
    rows.map(async (r) => ({
      userId: r.userId,
      gameName: r.gameName,
      tagLine: r.tagLine,
      role: r.role,
      currentRank: await getCurrentRank(db, r.riotAccountId),
    })),
  );
  return { id: team.id, slug: team.slug, name: team.name, tag: team.tag, captainUserId: team.captainUserId, autoFormed: team.autoFormedTournamentId !== null, members };
}

export type TeamHistoryItem = { title: string; edition: number; slug: string; startsAt: Date; status: TournamentStatus; placement: number | null };

/** The team's confirmed registrations, newest tournament first, with the final placement once finished. */
export async function getTeamHistory(db: Db, teamId: string): Promise<TeamHistoryItem[]> {
  const rows = await db
    .select({
      registrationId: registrations.id,
      tournamentId: tournaments.id,
      title: tournaments.title,
      edition: tournaments.edition,
      slug: tournaments.slug,
      startsAt: tournaments.startsAt,
      status: tournaments.status,
    })
    .from(registrations)
    .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
    .where(and(eq(registrations.teamId, teamId), eq(registrations.status, "confirmed")))
    .orderBy(desc(tournaments.startsAt));
  const placements = await placementsFor(db, rows.map((r) => r.tournamentId));
  return rows.map(({ registrationId, tournamentId: _t, ...r }) => ({
    ...r,
    placement: r.status === "finished" ? (placements.get(registrationId) ?? null) : null,
  }));
}

export async function listTeamsForUser(
  db: Db,
  userId: string,
): Promise<{ id: string; slug: string; name: string; tag: string; role: "captain" | "member" }[]> {
  return db
    .select({ id: teams.id, slug: teams.slug, name: teams.name, tag: teams.tag, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.name));
}

const requestColumns = {
  id: teamRequests.id,
  teamId: teamRequests.teamId,
  userId: teamRequests.userId,
  kind: teamRequests.kind,
  tournamentId: teamRequests.tournamentId,
  status: teamRequests.status,
};

export async function listPendingRequestsForUser(
  db: Db,
  userId: string,
): Promise<{
  invites: (TeamRequest & { teamName: string; teamSlug: string })[];
  requests: (TeamRequest & { teamName: string; teamSlug: string })[];
}> {
  const rows = await db
    .select({ ...requestColumns, teamName: teams.name, teamSlug: teams.slug })
    .from(teamRequests)
    .innerJoin(teams, eq(teams.id, teamRequests.teamId))
    .where(and(eq(teamRequests.userId, userId), eq(teamRequests.status, "pending")))
    .orderBy(asc(teamRequests.createdAt));
  return {
    invites: rows.filter((r) => r.kind === "invite"),
    requests: rows.filter((r) => r.kind === "join_request"),
  };
}

export async function listPendingRequestsForTeam(
  db: Db,
  teamId: string,
): Promise<(TeamRequest & { gameName: string; tagLine: string })[]> {
  return db
    .select({ ...requestColumns, gameName: riotAccounts.gameName, tagLine: riotAccounts.tagLine })
    .from(teamRequests)
    .innerJoin(riotAccounts, eq(riotAccounts.userId, teamRequests.userId))
    .where(and(eq(teamRequests.teamId, teamId), eq(teamRequests.status, "pending")))
    .orderBy(asc(teamRequests.createdAt));
}
