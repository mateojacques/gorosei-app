import { and, asc, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { evaluateEligibility } from "../../shared/eligibility";
import type { EligibilityFailure, PlayerSnapshot, RosterEntry } from "../../shared/eligibility";
import { formatRiotId } from "../../shared/riot-id";
import { ROSTER_STARTERS } from "../../shared/tournament";
import type { RegistrationStatus, TournamentStatus } from "../../shared/tournament";
import { writeAudit } from "../audit";
import { uniqueViolation } from "../db/client";
import type { Db, Executor } from "../db/client";
import {
  eligibilityExceptions,
  entryPayments,
  rankSnapshots,
  registrationPlayers,
  registrations,
  riotAccounts,
  teamMembers,
  teams,
  tournaments,
} from "../db/schema";
import { getEffectiveRank, recordRankSnapshot } from "../identity/ranks";
import type { RankSource } from "../identity/ranks";
import type { RiotClient } from "../riot/types";
import { lockTournament, paidUserIds, recomputeConfirmations, rosterQualifies } from "./confirmations";
import type { Tournament } from "./tournaments";

export type RegistrationDeps = { db: Db; riot: RiotClient; now?: () => Date };
export type RosterInput = { starters: string[]; subs: string[] };
export type RosterRejection =
  | "not_captain"
  | "registration_closed"
  | "already_registered"
  | "player_not_member"
  | "player_already_registered"
  | "riot_required"
  | "too_many_starters"
  | "too_many_subs"
  | "locked"
  | "would_unconfirm"
  | "ineligible";
export type RosterResult =
  | { ok: true; registrationId: string }
  | { ok: false; reason: RosterRejection; failures?: EligibilityFailure[] };

/**
 * `joining` users are about to become team members: the pre-check treats them as members. `inTransaction` runs
 * after the team, tournament and registration locks and before the membership re-check, and must insert the
 * `team_members` rows for `joining`. Anything it wrote is rolled back if the roster is then rejected.
 */
export type RosterHooks = { joining?: string[]; inTransaction?: (tx: Executor) => Promise<void> };

/** Thrown inside the transaction to undo a hook's writes when the roster is rejected after the hook ran. */
class RosterRollback extends Error {
  constructor(readonly result: RosterResult) {
    super("roster rolled back");
  }
}

export type RegistrationView = {
  id: string;
  status: RegistrationStatus;
  tournamentId: string;
  team: { id: string; slug: string; name: string; tag: string; captainUserId: string };
  roster: (RosterEntry & { paid: boolean })[];
  paidCount: number;
  failures: EligibilityFailure[];
};

/** Roster changes are allowed until check-in starts. */
const EDITABLE_STATUSES: readonly TournamentStatus[] = ["registration_open", "registration_closed"];
const INACTIVE_STATUSES: RegistrationStatus[] = ["withdrawn", "dropped"];

type TakenSnapshot = { riotAccountId: string; snapshot: PlayerSnapshot };

export async function snapshotWithAccount(
  deps: RegistrationDeps,
  userId: string,
  rankSource: RankSource,
): Promise<TakenSnapshot | null> {
  const { db } = deps;
  const [linked] = await db.select({ id: riotAccounts.id }).from(riotAccounts).where(eq(riotAccounts.userId, userId));
  if (!linked) return null;
  // A failed refresh falls back to the latest stored data.
  if (rankSource === "current") await recordRankSnapshot(deps, linked.id);

  const [account] = await db.select().from(riotAccounts).where(eq(riotAccounts.id, linked.id));
  const [latest] = await db
    .select({ wins: rankSnapshots.wins, losses: rankSnapshots.losses })
    .from(rankSnapshots)
    .where(eq(rankSnapshots.riotAccountId, linked.id))
    .orderBy(desc(rankSnapshots.observedAt))
    .limit(1);
  return {
    riotAccountId: linked.id,
    snapshot: {
      userId,
      riotId: formatRiotId(account!),
      rank: await getEffectiveRank(db, linked.id, rankSource),
      summonerLevel: account!.summonerLevel,
      rankedGames: latest ? latest.wins + latest.losses : 0,
      takenAt: (deps.now?.() ?? new Date()).toISOString(),
    },
  };
}

export async function takePlayerSnapshot(
  deps: RegistrationDeps,
  userId: string,
  rankSource: RankSource,
): Promise<PlayerSnapshot | null> {
  return (await snapshotWithAccount(deps, userId, rankSource))?.snapshot ?? null;
}

export function evaluateRegistration(
  tournament: Tournament,
  roster: RosterEntry[],
  exemptRuleIds: string[],
): EligibilityFailure[] {
  return evaluateEligibility(tournament.eligibilityRules, roster, {
    subsCountForTeamRules: tournament.subsCountForTeamRules,
    exemptRuleIds,
  });
}

function rosterShape(tournament: Tournament, roster: RosterInput): RosterRejection | null {
  if (roster.starters.length > ROSTER_STARTERS) return "too_many_starters";
  if (roster.subs.length > tournament.maxSubs) return "too_many_subs";
  // Listing the same player twice is treated like registering them twice.
  const ids = [...roster.starters, ...roster.subs];
  if (new Set(ids).size !== ids.length) return "player_already_registered";
  return null;
}

async function allMembers(db: Executor, teamId: string, userIds: string[]): Promise<boolean> {
  if (userIds.length === 0) return true;
  const rows = await db
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), inArray(teamMembers.userId, userIds)));
  return rows.length === userIds.length;
}

/** True when any of the players is on another active roster in the tournament. */
async function onOtherRoster(
  db: Executor,
  tournamentId: string,
  userIds: string[],
  exceptRegistrationId?: string,
): Promise<boolean> {
  if (userIds.length === 0) return false;
  const [row] = await db
    .select({ userId: registrationPlayers.userId })
    .from(registrationPlayers)
    .where(
      and(
        eq(registrationPlayers.tournamentId, tournamentId),
        eq(registrationPlayers.active, true),
        inArray(registrationPlayers.userId, userIds),
        exceptRegistrationId ? ne(registrationPlayers.registrationId, exceptRegistrationId) : undefined,
      ),
    )
    .limit(1);
  return !!row;
}

export async function exemptRuleIdsFor(db: Executor, tournamentId: string, teamId: string): Promise<string[]> {
  const rows = await db
    .select({ ruleId: eligibilityExceptions.ruleId })
    .from(eligibilityExceptions)
    .where(and(eq(eligibilityExceptions.tournamentId, tournamentId), eq(eligibilityExceptions.teamId, teamId)));
  return rows.map((r) => r.ruleId);
}

/** Snapshots the players, or null when one has no Riot account; call it outside any transaction (it may hit Riot). */
async function takeSnapshots(
  deps: RegistrationDeps,
  tournament: Tournament,
  userIds: string[],
): Promise<Map<string, TakenSnapshot> | null> {
  const taken = await Promise.all(userIds.map((id) => snapshotWithAccount(deps, id, tournament.rankSource)));
  if (taken.some((s) => s === null)) return null;
  return new Map(taken.map((s) => [s!.snapshot.userId, s!]));
}

function toEntries(roster: RosterInput, snapshots: Map<string, TakenSnapshot>): RosterEntry[] {
  return [
    ...roster.starters.map((id) => ({ ...snapshots.get(id)!.snapshot, isSub: false })),
    ...roster.subs.map((id) => ({ ...snapshots.get(id)!.snapshot, isSub: true })),
  ];
}

function rejectOnConflict(error: unknown): RosterResult {
  const constraint = uniqueViolation(error);
  if (constraint === "registration_players_one_active_idx") return { ok: false, reason: "player_already_registered" };
  if (constraint === "registrations_one_active_per_team_idx") return { ok: false, reason: "already_registered" };
  throw error;
}

export async function registerTeam(
  deps: RegistrationDeps,
  captainId: string,
  tournamentId: string,
  teamId: string,
  roster: RosterInput,
): Promise<RosterResult> {
  const { db } = deps;
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!tournament || tournament.status !== "registration_open") return { ok: false, reason: "registration_closed" };
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId));
  if (!team || team.captainUserId !== captainId) return { ok: false, reason: "not_captain" };
  const shape = rosterShape(tournament, roster);
  if (shape) return { ok: false, reason: shape };
  const userIds = [...roster.starters, ...roster.subs];
  if (!(await allMembers(db, teamId, userIds))) return { ok: false, reason: "player_not_member" };
  const [existing] = await db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.tournamentId, tournamentId),
        eq(registrations.teamId, teamId),
        notInArray(registrations.status, INACTIVE_STATUSES),
      ),
    );
  if (existing) return { ok: false, reason: "already_registered" };
  if (await onOtherRoster(db, tournamentId, userIds)) return { ok: false, reason: "player_already_registered" };

  const snapshots = await takeSnapshots(deps, tournament, userIds);
  if (!snapshots) return { ok: false, reason: "riot_required" };
  const failures = evaluateRegistration(tournament, toEntries(roster, snapshots), await exemptRuleIdsFor(db, tournamentId, teamId));
  if (failures.length > 0) return { ok: false, reason: "ineligible", failures };

  try {
    return await db.transaction(async (tx): Promise<RosterResult> => {
      // Locking the team serializes with members leaving or being removed.
      const [locked] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
      if (!locked || locked.captainUserId !== captainId) return { ok: false, reason: "not_captain" };
      if (!(await allMembers(tx, teamId, userIds))) return { ok: false, reason: "player_not_member" };
      const current = await lockTournament(tx, tournamentId);
      if (current!.status !== "registration_open") return { ok: false, reason: "registration_closed" };

      const [registration] = await tx
        .insert(registrations)
        .values({ tournamentId, teamId })
        .returning({ id: registrations.id });
      const registrationId = registration!.id;
      if (userIds.length > 0) {
        await tx.insert(registrationPlayers).values(
          toEntries(roster, snapshots).map(({ isSub, ...snapshot }) => ({
            registrationId,
            userId: snapshot.userId,
            tournamentId,
            riotAccountId: snapshots.get(snapshot.userId)!.riotAccountId,
            isSub,
            snapshot,
          })),
        );
      }
      await writeAudit(tx, {
        actorUserId: captainId,
        action: "registration.created",
        entityType: "registration",
        entityId: registrationId,
        data: { tournamentId, teamId, starters: roster.starters, subs: roster.subs },
      });
      await recomputeConfirmations(tx, tournamentId, new Date());
      return { ok: true, registrationId };
    });
  } catch (error) {
    // Two rosters racing for the same player (or team): the partial unique indexes are the final arbiter.
    return rejectOnConflict(error);
  }
}

async function loadRegistration(db: Executor, registrationId: string) {
  const [row] = await db
    .select({ registration: registrations, tournament: tournaments, captainUserId: teams.captainUserId })
    .from(registrations)
    .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(eq(registrations.id, registrationId));
  return row;
}

const isLocked = (registration: { status: RegistrationStatus }, tournament: { status: TournamentStatus }) =>
  INACTIVE_STATUSES.includes(registration.status) || !EDITABLE_STATUSES.includes(tournament.status);

export async function updateRoster(
  deps: RegistrationDeps,
  captainId: string,
  registrationId: string,
  roster: RosterInput,
  hooks: RosterHooks = {},
): Promise<RosterResult> {
  const { db } = deps;
  const loaded = await loadRegistration(db, registrationId);
  if (!loaded || loaded.captainUserId !== captainId) return { ok: false, reason: "not_captain" };
  const { registration, tournament } = loaded;
  if (isLocked(registration, tournament)) return { ok: false, reason: "locked" };
  const shape = rosterShape(tournament, roster);
  if (shape) return { ok: false, reason: shape };
  const userIds = [...roster.starters, ...roster.subs];
  const joining = hooks.joining ?? [];
  const existingMembers = userIds.filter((id) => !joining.includes(id));
  if (!(await allMembers(db, registration.teamId, existingMembers))) return { ok: false, reason: "player_not_member" };
  if (await onOtherRoster(db, tournament.id, userIds, registrationId)) {
    return { ok: false, reason: "player_already_registered" };
  }

  const existingRows = await db.select().from(registrationPlayers).where(eq(registrationPlayers.registrationId, registrationId));
  const snapshots = new Map<string, TakenSnapshot>(
    existingRows.map((r) => [r.userId, { riotAccountId: r.riotAccountId, snapshot: r.snapshot }]),
  );
  const added = await takeSnapshots(
    deps,
    tournament,
    userIds.filter((id) => !snapshots.has(id)),
  );
  if (!added) return { ok: false, reason: "riot_required" };
  for (const [id, s] of added) snapshots.set(id, s);
  const failures = evaluateRegistration(
    tournament,
    toEntries(roster, snapshots),
    await exemptRuleIdsFor(db, tournament.id, registration.teamId),
  );
  if (failures.length > 0) return { ok: false, reason: "ineligible", failures };

  let hookRan = false;
  const rejectAfterHook = (result: RosterResult): RosterResult => {
    if (hookRan) throw new RosterRollback(result);
    return result;
  };
  try {
    const result = await db.transaction(async (tx): Promise<RosterResult> => {
      await tx.select({ id: teams.id }).from(teams).where(eq(teams.id, registration.teamId)).for("update");
      const current = await lockTournament(tx, tournament.id);
      const [locked] = await tx.select().from(registrations).where(eq(registrations.id, registrationId)).for("update");
      if (isLocked(locked!, current!)) return { ok: false, reason: "locked" };
      if (hooks.inTransaction) {
        await hooks.inTransaction(tx);
        hookRan = true;
      }
      if (!(await allMembers(tx, registration.teamId, userIds))) return rejectAfterHook({ ok: false, reason: "player_not_member" });
      // A confirmed team's change must keep it confirmed: full, eligible and paid.
      if (
        locked!.status === "confirmed" &&
        !rosterQualifies(
          current!,
          toEntries(roster, snapshots),
          await exemptRuleIdsFor(tx, tournament.id, registration.teamId),
          await paidUserIds(tx, tournament.id),
        )
      ) {
        return rejectAfterHook({ ok: false, reason: "would_unconfirm" });
      }

      const before = await tx
        .select({ userId: registrationPlayers.userId })
        .from(registrationPlayers)
        .where(eq(registrationPlayers.registrationId, registrationId));
      const beforeIds = new Set(before.map((r) => r.userId));
      const removed = [...beforeIds].filter((id) => !userIds.includes(id));
      if (removed.length > 0) {
        await tx
          .delete(registrationPlayers)
          .where(and(eq(registrationPlayers.registrationId, registrationId), inArray(registrationPlayers.userId, removed)));
      }
      for (const { isSub, ...snapshot } of toEntries(roster, snapshots)) {
        if (beforeIds.has(snapshot.userId)) {
          // Kept players keep the snapshot taken when they joined the roster.
          await tx
            .update(registrationPlayers)
            .set({ isSub })
            .where(and(eq(registrationPlayers.registrationId, registrationId), eq(registrationPlayers.userId, snapshot.userId)));
        } else {
          await tx.insert(registrationPlayers).values({
            registrationId,
            userId: snapshot.userId,
            tournamentId: tournament.id,
            riotAccountId: snapshots.get(snapshot.userId)!.riotAccountId,
            isSub,
            snapshot,
          });
        }
      }
      await tx.update(registrations).set({ updatedAt: new Date() }).where(eq(registrations.id, registrationId));
      await writeAudit(tx, {
        actorUserId: captainId,
        action: "registration.roster_updated",
        entityType: "registration",
        entityId: registrationId,
        data: {
          starters: roster.starters,
          subs: roster.subs,
          added: userIds.filter((id) => !beforeIds.has(id)),
          removed,
        },
      });
      await recomputeConfirmations(tx, tournament.id, new Date());
      return { ok: true, registrationId };
    });
    return result;
  } catch (error) {
    if (error instanceof RosterRollback) return error.result;
    return rejectOnConflict(error);
  }
}

export async function withdrawRegistration(
  db: Db,
  captainId: string,
  registrationId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_captain" | "locked" }> {
  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ tournamentId: registrations.tournamentId })
      .from(registrations)
      .where(eq(registrations.id, registrationId));
    if (!found) return { ok: false, reason: "not_captain" } as const;
    await lockTournament(tx, found.tournamentId);
    await tx.select({ id: registrations.id }).from(registrations).where(eq(registrations.id, registrationId)).for("update");
    const loaded = await loadRegistration(tx, registrationId);
    if (!loaded || loaded.captainUserId !== captainId) return { ok: false, reason: "not_captain" } as const;
    if (isLocked(loaded.registration, loaded.tournament)) return { ok: false, reason: "locked" } as const;

    if (loaded.registration.status === "confirmed") {
      // A confirmed team that withdraws gets no refund or credit: its roster's payments are forfeited.
      const roster = await tx
        .select({ userId: registrationPlayers.userId })
        .from(registrationPlayers)
        .where(eq(registrationPlayers.registrationId, registrationId));
      if (roster.length > 0) {
        const forfeited = await tx
          .update(entryPayments)
          .set({ forfeited: true })
          .where(
            and(
              eq(entryPayments.tournamentId, found.tournamentId),
              eq(entryPayments.forfeited, false),
              inArray(
                entryPayments.userId,
                roster.map((r) => r.userId),
              ),
            ),
          )
          .returning();
        for (const payment of forfeited) {
          await writeAudit(tx, {
            actorUserId: captainId,
            action: "payment.forfeited",
            entityType: "entry_payment",
            entityId: payment.id,
            data: { tournamentId: found.tournamentId, userId: payment.userId, registrationId, reference: payment.reference },
          });
        }
      }
    }
    await tx
      .update(registrations)
      .set({ status: "withdrawn", qualifiedAt: null, updatedAt: new Date() })
      .where(eq(registrations.id, registrationId));
    await tx.update(registrationPlayers).set({ active: false }).where(eq(registrationPlayers.registrationId, registrationId));
    await writeAudit(tx, {
      actorUserId: captainId,
      action: "registration.withdrawn",
      entityType: "registration",
      entityId: registrationId,
      data: { from: loaded.registration.status },
    });
    await recomputeConfirmations(tx, found.tournamentId, new Date());
    return { ok: true } as const;
  });
}

const STATUS_ORDER: Record<RegistrationStatus, number> = {
  confirmed: 0,
  waitlisted: 1,
  pending: 2,
  withdrawn: 3,
  dropped: 3,
};

type RegistrationRow = { registration: typeof registrations.$inferSelect; team: typeof teams.$inferSelect };

async function buildViews(db: Db, tournament: Tournament, rows: RegistrationRow[]): Promise<RegistrationView[]> {
  if (rows.length === 0) return [];
  const players = await db
    .select()
    .from(registrationPlayers)
    .where(
      inArray(
        registrationPlayers.registrationId,
        rows.map((r) => r.registration.id),
      ),
    );
  const exceptions = await db
    .select({ teamId: eligibilityExceptions.teamId, ruleId: eligibilityExceptions.ruleId })
    .from(eligibilityExceptions)
    .where(eq(eligibilityExceptions.tournamentId, tournament.id));
  const paid = await paidUserIds(db, tournament.id);

  return rows.map(({ registration, team }) => {
    const roster = players
      .filter((p) => p.registrationId === registration.id)
      .map((p) => ({ ...p.snapshot, isSub: p.isSub, paid: paid.has(p.userId) }))
      .sort((a, b) => Number(a.isSub) - Number(b.isSub) || a.riotId.localeCompare(b.riotId));
    const exempt = exceptions.filter((e) => e.teamId === team.id).map((e) => e.ruleId);
    return {
      id: registration.id,
      status: registration.status,
      tournamentId: registration.tournamentId,
      team: { id: team.id, slug: team.slug, name: team.name, tag: team.tag, captainUserId: team.captainUserId },
      roster,
      paidCount: roster.filter((p) => p.paid).length,
      failures: evaluateRegistration(tournament, roster, exempt),
    };
  });
}

const registrationRow = { registration: registrations, team: teams };

export async function getRegistrationView(db: Db, registrationId: string): Promise<RegistrationView | null> {
  const [row] = await db
    .select({ ...registrationRow, tournament: tournaments })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .innerJoin(tournaments, eq(tournaments.id, registrations.tournamentId))
    .where(eq(registrations.id, registrationId));
  if (!row) return null;
  const [view] = await buildViews(db, row.tournament, [row]);
  return view ?? null;
}

export async function getRegistrationForTeam(
  db: Db,
  tournamentId: string,
  teamSlug: string,
): Promise<RegistrationView | null> {
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!tournament) return null;
  // The live registration wins; otherwise the most recent withdrawn or dropped one.
  const [row] = await db
    .select(registrationRow)
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(and(eq(registrations.tournamentId, tournamentId), eq(teams.slug, teamSlug)))
    .orderBy(sql`${registrations.status} in ('withdrawn', 'dropped')`, desc(registrations.createdAt))
    .limit(1);
  if (!row) return null;
  const [view] = await buildViews(db, tournament, [row]);
  return view ?? null;
}

export async function listRegistrations(db: Db, tournamentId: string): Promise<RegistrationView[]> {
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!tournament) return [];
  const rows = await db
    .select(registrationRow)
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(eq(registrations.tournamentId, tournamentId))
    .orderBy(asc(registrations.createdAt));
  const views = await buildViews(db, tournament, rows);
  return views.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
}
