import { and, asc, eq } from "drizzle-orm";
import type { EligibilityFailure, PlayerSnapshot } from "../../shared/eligibility";
import { formatRiotId } from "../../shared/riot-id";
import { ROSTER_STARTERS } from "../../shared/tournament";
import { uniqueViolation } from "../db/client";
import type { Db, Executor } from "../db/client";
import { registrationPlayers, registrations, riotAccounts, teamMembers, teamRequests, teams, tournaments } from "../db/schema";
import { evaluateRegistration, exemptRuleIdsFor } from "../tournaments/registrations";
import { paidUserIds } from "../tournaments/confirmations";
import type { Tournament } from "../tournaments/tournaments";
import { getAvailableEntry, getPoolEntry } from "./pool";

export type OpenTeam = {
  registrationId: string;
  teamSlug: string;
  teamName: string;
  tag: string;
  captainRiotId: string;
  starterCount: number;
  paidCount: number;
};

export type RequestRejection =
  | "closed"
  | "not_in_pool"
  | "not_captain"
  | "team_not_registered"
  | "roster_full"
  | "already_member"
  | "already_pending"
  | "ineligible";
export type RequestResult =
  | { ok: true; requestId: string }
  | { ok: false; reason: RequestRejection; failures?: EligibilityFailure[] };

type RegistrationContext = {
  registration: typeof registrations.$inferSelect;
  team: typeof teams.$inferSelect;
  tournament: Tournament;
  starters: PlayerSnapshot[];
};

async function loadContext(db: Executor, registrationId: string): Promise<RegistrationContext | null> {
  const [row] = await db
    .select({ registration: registrations, team: teams, tournament: tournaments })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
    .where(eq(registrations.id, registrationId));
  if (!row) return null;
  const players = await db
    .select({ snapshot: registrationPlayers.snapshot })
    .from(registrationPlayers)
    .where(
      and(
        eq(registrationPlayers.registrationId, registrationId),
        eq(registrationPlayers.isSub, false),
        eq(registrationPlayers.active, true),
      ),
    );
  return { ...row, starters: players.map((p) => p.snapshot) };
}

/** Eligibility of the team's starters plus the candidate as one more starter; pool snapshots are used (no Riot call). */
async function fitFailures(db: Executor, context: RegistrationContext, candidate: PlayerSnapshot): Promise<EligibilityFailure[]> {
  const { tournament, registration, starters } = context;
  const roster = [...starters, candidate].map((s) => ({ ...s, isSub: false }));
  return evaluateRegistration(tournament, roster, await exemptRuleIdsFor(db, tournament.id, registration.teamId));
}

/** Why a registration can't take a pool player right now, or null. Shared by requests and invites. */
async function checkTarget(db: Executor, context: RegistrationContext | null, userId: string): Promise<RequestRejection | null> {
  if (!context || ["withdrawn", "dropped"].includes(context.registration.status)) return "team_not_registered";
  if (context.tournament.status !== "registration_open") return "closed";
  const [member] = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, context.team.id), eq(teamMembers.userId, userId)));
  if (member) return "already_member";
  if (!(await getAvailableEntry(db, context.tournament.id, userId))) return "not_in_pool";
  // A confirmed or waitlisted team is full; the pool only fills starter slots.
  if (context.registration.status !== "pending" || context.starters.length >= ROSTER_STARTERS) return "roster_full";
  return null;
}

async function insertRequest(
  db: Db,
  registrationId: string,
  userId: string,
  kind: "invite" | "join_request",
  actorIsCaptain: string | null,
): Promise<RequestResult> {
  try {
    return await db.transaction(async (tx): Promise<RequestResult> => {
      const context = await loadContext(tx, registrationId);
      if (!context) return { ok: false, reason: "team_not_registered" };
      // Locking the team serializes with members leaving and captains answering requests.
      const [team] = await tx.select().from(teams).where(eq(teams.id, context.team.id)).for("update");
      if (actorIsCaptain !== null && team!.captainUserId !== actorIsCaptain) return { ok: false, reason: "not_captain" };
      const rejection = await checkTarget(tx, context, userId);
      if (rejection) return { ok: false, reason: rejection };
      const [pending] = await tx
        .select({ id: teamRequests.id })
        .from(teamRequests)
        .where(and(eq(teamRequests.teamId, team!.id), eq(teamRequests.userId, userId), eq(teamRequests.status, "pending")));
      if (pending) return { ok: false, reason: "already_pending" };
      const entry = (await getPoolEntry(tx, context.tournament.id, userId))!;
      const failures = await fitFailures(tx, context, entry.snapshot);
      if (failures.length > 0) return { ok: false, reason: "ineligible", failures };
      const [request] = await tx
        .insert(teamRequests)
        .values({ teamId: team!.id, userId, kind, tournamentId: context.tournament.id })
        .returning({ id: teamRequests.id });
      return { ok: true, requestId: request!.id };
    });
  } catch (error) {
    if (uniqueViolation(error) === "team_requests_one_pending_idx") return { ok: false, reason: "already_pending" };
    throw error;
  }
}

export async function requestFromPool(db: Db, userId: string, registrationId: string): Promise<RequestResult> {
  return insertRequest(db, registrationId, userId, "join_request", null);
}

export async function recruitFromPool(db: Db, captainId: string, registrationId: string, userId: string): Promise<RequestResult> {
  return insertRequest(db, registrationId, userId, "invite", captainId);
}

/** Teams still missing starters that the viewer, as a pool player, could join without breaking the rules. */
export async function listOpenTeams(db: Db, tournamentId: string, userId: string): Promise<OpenTeam[]> {
  const entry = await getAvailableEntry(db, tournamentId, userId);
  if (!entry) return [];
  const rows = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(and(eq(registrations.tournamentId, tournamentId), eq(registrations.status, "pending")))
    .orderBy(asc(registrations.createdAt));
  if (rows.length === 0) return [];
  const paid = await paidUserIds(db, tournamentId);
  const memberships = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId));
  const own = new Set(memberships.map((m) => m.teamId));

  const open: OpenTeam[] = [];
  for (const { id } of rows) {
    const context = (await loadContext(db, id))!;
    if (context.starters.length >= ROSTER_STARTERS || own.has(context.team.id)) continue;
    if ((await fitFailures(db, context, entry.snapshot)).length > 0) continue;
    const [captain] = await db.select().from(riotAccounts).where(eq(riotAccounts.userId, context.team.captainUserId));
    open.push({
      registrationId: id,
      teamSlug: context.team.slug,
      teamName: context.team.name,
      tag: context.team.tag,
      captainRiotId: captain ? formatRiotId(captain) : "",
      starterCount: context.starters.length,
      paidCount: context.starters.filter((s) => paid.has(s.userId)).length,
    });
  }
  return open;
}
