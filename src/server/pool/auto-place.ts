import { and, asc, eq, like, sql } from "drizzle-orm";
import { planAutoPlacement } from "../../shared/auto-place";
import type { PoolCandidate } from "../../shared/auto-place";
import { evaluatePlayerRules } from "../../shared/eligibility";
import type { PlayerSnapshot } from "../../shared/eligibility";
import { writeAudit } from "../audit";
import type { Executor } from "../db/client";
import { poolEntries, registrationPlayers, registrations, teamMembers, teams } from "../db/schema";
import { createTeamRow } from "../teams/teams";
import { snapshotFromStored } from "../tournaments/registrations";
import type { Tournament } from "../tournaments/tournaments";
import { availablePoolCondition } from "./pool";

export type PoolPlan = {
  plan: ReturnType<typeof planAutoPlacement>;
  riotIds: Map<string, string>;
  /** Auto-place players who no longer pass the per-player rules; they are left out and credited at close. */
  failing: string[];
  snapshots: Map<string, { riotAccountId: string; snapshot: PlayerSnapshot }>;
};

/** The teams auto-placement would form right now, from stored data only (no Riot call). */
export async function planPoolPlacement(db: Executor, tournament: Tournament, now: Date): Promise<PoolPlan> {
  const entries = await db
    .select()
    .from(poolEntries)
    .where(and(availablePoolCondition(tournament.id), eq(poolEntries.autoPlace, true)))
    .orderBy(asc(poolEntries.joinedAt));

  const candidates: PoolCandidate[] = [];
  const snapshots = new Map<string, { riotAccountId: string; snapshot: PlayerSnapshot }>();
  const failing: string[] = [];
  for (const entry of entries) {
    // Ranks may have moved since the player entered; the rank poll keeps the stored data fresh.
    const taken = await snapshotFromStored(db, entry.userId, tournament.rankSource, now);
    if (!taken) continue;
    if (evaluatePlayerRules(tournament.eligibilityRules, taken.snapshot).length > 0) {
      failing.push(entry.userId);
      continue;
    }
    snapshots.set(entry.userId, taken);
    candidates.push({ snapshot: taken.snapshot, roles: entry.roles, joinedAt: entry.joinedAt });
  }

  const [confirmed] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.tournamentId, tournament.id), eq(registrations.status, "confirmed")));
  const maxTeams = Math.max(0, tournament.teamCap - (confirmed?.count ?? 0));

  const plan = planAutoPlacement(candidates, { rules: tournament.eligibilityRules, maxTeams });
  return { plan, riotIds: new Map(candidates.map((c) => [c.snapshot.userId, c.snapshot.riotId])), failing, snapshots };
}

async function nextTagCounter(tx: Executor): Promise<number> {
  const rows = await tx.select({ tag: teams.tag }).from(teams).where(like(teams.tag, "AL%"));
  const taken = new Set(rows.map((r) => r.tag));
  let n = 0;
  while (taken.has(`AL${n.toString(36).toUpperCase()}`)) n++;
  return n;
}

async function availableName(tx: Executor, edition: number, from: number): Promise<{ name: string; n: number }> {
  const rows = await tx.select({ name: sql<string>`lower(${teams.name})` }).from(teams);
  const taken = new Set(rows.map((r) => r.name));
  let n = from;
  while (taken.has(`agentes libres ${edition}-${n}`)) n++;
  return { name: `Agentes libres ${edition}-${n}`, n };
}

/**
 * Creates a team, a pending registration and the roster for each planned team. Runs inside the close transaction;
 * the caller recomputes confirmations afterwards.
 */
export async function autoPlacePool(
  tx: Executor,
  tournament: Tournament,
  now: Date,
): Promise<{ teams: number; placed: number }> {
  const { plan, snapshots } = await planPoolPlacement(tx, tournament, now);
  let tagCounter = await nextTagCounter(tx);
  let nameFrom = 1;
  let placed = 0;

  for (const planned of plan.teams) {
    const { name, n } = await availableName(tx, tournament.edition, nameFrom);
    nameFrom = n + 1;
    const tag = `AL${(tagCounter++).toString(36).toUpperCase()}`;
    const team = await createTeamRow(tx, {
      name,
      tag,
      captainUserId: planned.captainUserId,
      autoFormedTournamentId: tournament.id,
    });
    const others = planned.members.filter((m) => m.userId !== planned.captainUserId);
    await tx.insert(teamMembers).values(others.map((m) => ({ teamId: team.id, userId: m.userId, role: "member" as const })));
    const [registration] = await tx
      .insert(registrations)
      .values({ tournamentId: tournament.id, teamId: team.id })
      .returning({ id: registrations.id });
    await tx.insert(registrationPlayers).values(
      planned.members.map((m) => ({
        registrationId: registration!.id,
        userId: m.userId,
        tournamentId: tournament.id,
        riotAccountId: snapshots.get(m.userId)!.riotAccountId,
        isSub: false,
        snapshot: snapshots.get(m.userId)!.snapshot,
      })),
    );
    await writeAudit(tx, {
      actorUserId: null,
      action: "pool.auto_placed",
      entityType: "registration",
      entityId: registration!.id,
      data: { tournamentId: tournament.id, teamId: team.id, captain: planned.captainUserId, members: planned.members },
    });
    placed += planned.members.length;
  }
  return { teams: plan.teams.length, placed };
}
