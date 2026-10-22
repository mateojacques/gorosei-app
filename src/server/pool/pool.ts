import { and, asc, eq, exists, not, or, sql } from "drizzle-orm";
import { evaluatePlayerRules } from "../../shared/eligibility";
import type { EligibilityFailure } from "../../shared/eligibility";
import { poolEntryInputSchema } from "../../shared/pool";
import type { Role } from "../../shared/pool";
import { compareRanks } from "../../shared/rank";
import type { Rank } from "../../shared/rank";
import { writeAudit } from "../audit";
import type { Db, Executor } from "../db/client";
import { entryPayments, poolEntries, registrationPlayers, tournaments } from "../db/schema";
import { lockTournament, paidUserIds } from "../tournaments/confirmations";
import { snapshotWithAccount } from "../tournaments/registrations";
import type { RegistrationDeps } from "../tournaments/registrations";

export type PoolEntry = typeof poolEntries.$inferSelect;
export type PoolRejection =
  | "registration_closed"
  | "riot_required"
  | "not_paid"
  | "already_on_roster"
  | "ineligible"
  | "invalid_roles"
  | "not_in_pool";

/**
 * A pool player is available when the entry is active, the entry fee is covered (a live payment, or a free
 * tournament) and they are on no active roster of the tournament. "Placed" is never stored, so every path that
 * puts someone on a roster takes them out of the pool without any sync code.
 */
export function availablePoolCondition(tournamentId: string) {
  return and(
    eq(poolEntries.tournamentId, tournamentId),
    eq(poolEntries.active, true),
    or(
      sql`(select ${tournaments.entryFeeArs} from ${tournaments} where ${tournaments.id} = ${poolEntries.tournamentId}) = 0`,
      exists(
        sql`(select 1 from ${entryPayments} where ${entryPayments.tournamentId} = ${poolEntries.tournamentId}
          and ${entryPayments.userId} = ${poolEntries.userId} and ${entryPayments.forfeited} = false)`,
      ),
    ),
    not(
      exists(
        sql`(select 1 from ${registrationPlayers} where ${registrationPlayers.tournamentId} = ${poolEntries.tournamentId}
          and ${registrationPlayers.userId} = ${poolEntries.userId} and ${registrationPlayers.active} = true)`,
      ),
    ),
  );
}

export async function getPoolEntry(db: Executor, tournamentId: string, userId: string): Promise<PoolEntry | null> {
  const [row] = await db
    .select()
    .from(poolEntries)
    .where(and(eq(poolEntries.tournamentId, tournamentId), eq(poolEntries.userId, userId)));
  return row ?? null;
}

export async function countPool(db: Executor, tournamentId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(poolEntries)
    .where(availablePoolCondition(tournamentId));
  return row?.count ?? 0;
}

async function isOnRoster(db: Executor, tournamentId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: registrationPlayers.userId })
    .from(registrationPlayers)
    .where(
      and(
        eq(registrationPlayers.tournamentId, tournamentId),
        eq(registrationPlayers.userId, userId),
        eq(registrationPlayers.active, true),
      ),
    );
  return !!row;
}

const hasPaid = async (db: Executor, tournament: { id: string; entryFeeArs: number }, userId: string) =>
  tournament.entryFeeArs === 0 || (await paidUserIds(db, tournament.id)).has(userId);

export async function enterPool(
  deps: RegistrationDeps,
  userId: string,
  tournamentId: string,
  input: { roles: Role[]; autoPlace: boolean },
): Promise<{ ok: true } | { ok: false; reason: PoolRejection; failures?: EligibilityFailure[] }> {
  const { db } = deps;
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!tournament || tournament.status !== "registration_open") return { ok: false, reason: "registration_closed" };
  const parsed = poolEntryInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_roles" };
  const { roles, autoPlace } = parsed.data;

  // The snapshot may call Riot, so it is taken before the transaction.
  const taken = await snapshotWithAccount(deps, userId, tournament.rankSource);
  if (!taken) return { ok: false, reason: "riot_required" };
  if (await isOnRoster(db, tournamentId, userId)) return { ok: false, reason: "already_on_roster" };
  if (!(await hasPaid(db, tournament, userId))) return { ok: false, reason: "not_paid" };
  const failures = evaluatePlayerRules(tournament.eligibilityRules, taken.snapshot);
  if (failures.length > 0) return { ok: false, reason: "ineligible", failures };

  return db.transaction(async (tx) => {
    const current = await lockTournament(tx, tournamentId);
    if (current?.status !== "registration_open") return { ok: false, reason: "registration_closed" } as const;
    if (await isOnRoster(tx, tournamentId, userId)) return { ok: false, reason: "already_on_roster" } as const;
    if (!(await hasPaid(tx, current, userId))) return { ok: false, reason: "not_paid" } as const;

    const values = { riotAccountId: taken.riotAccountId, roles, autoPlace, snapshot: taken.snapshot, active: true };
    await tx
      .insert(poolEntries)
      .values({ tournamentId, userId, ...values })
      .onConflictDoUpdate({
        target: [poolEntries.tournamentId, poolEntries.userId],
        // Editing an active entry keeps its place in line; coming back after leaving starts a new one.
        set: { ...values, joinedAt: sql`case when ${poolEntries.active} then ${poolEntries.joinedAt} else now() end` },
      });
    await writeAudit(tx, {
      actorUserId: userId,
      action: "pool.entered",
      entityType: "tournament",
      entityId: tournamentId,
      data: { roles, autoPlace },
    });
    return { ok: true } as const;
  });
}

export async function leavePool(
  db: Db,
  userId: string,
  tournamentId: string,
): Promise<{ ok: true } | { ok: false; reason: "registration_closed" | "not_in_pool" }> {
  return db.transaction(async (tx) => {
    const tournament = await lockTournament(tx, tournamentId);
    if (tournament?.status !== "registration_open") return { ok: false, reason: "registration_closed" } as const;
    // The payment is untouched: unused, it becomes a credit when registration closes.
    const [left] = await tx
      .update(poolEntries)
      .set({ active: false })
      .where(and(eq(poolEntries.tournamentId, tournamentId), eq(poolEntries.userId, userId), eq(poolEntries.active, true)))
      .returning({ userId: poolEntries.userId });
    if (!left) return { ok: false, reason: "not_in_pool" } as const;
    await writeAudit(tx, {
      actorUserId: userId,
      action: "pool.left",
      entityType: "tournament",
      entityId: tournamentId,
      data: {},
    });
    return { ok: true } as const;
  });
}

export async function getAvailableEntry(db: Executor, tournamentId: string, userId: string): Promise<PoolEntry | null> {
  const [row] = await db
    .select()
    .from(poolEntries)
    .where(and(availablePoolCondition(tournamentId), eq(poolEntries.userId, userId)));
  return row ?? null;
}

export type PoolFilter = { role?: Role; minRank?: Rank; maxRank?: Rank };
export type PoolListing = {
  userId: string;
  riotId: string;
  rank: Rank | null;
  roles: Role[];
  level: number;
  joinedAt: Date;
};

/** Available players, best rank first, then by who joined first; the role filter matches any listed role. */
export async function listPool(db: Executor, tournamentId: string, filter: PoolFilter = {}): Promise<PoolListing[]> {
  const rows = await db
    .select()
    .from(poolEntries)
    .where(availablePoolCondition(tournamentId))
    .orderBy(asc(poolEntries.joinedAt));
  return rows
    .map((r) => ({
      userId: r.userId,
      riotId: r.snapshot.riotId,
      rank: r.snapshot.rank,
      roles: r.roles,
      level: r.snapshot.summonerLevel,
      joinedAt: r.joinedAt,
    }))
    .filter((p) => !filter.role || p.roles.includes(filter.role))
    .filter((p) => !filter.minRank || compareRanks(p.rank, filter.minRank) >= 0)
    .filter((p) => !filter.maxRank || compareRanks(p.rank, filter.maxRank) <= 0)
    .sort((a, b) => compareRanks(b.rank, a.rank) || a.joinedAt.getTime() - b.joinedAt.getTime());
}
