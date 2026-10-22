import { and, eq, notInArray } from "drizzle-orm";
import { evaluatePlayerRules } from "../../shared/eligibility";
import type { EligibilityFailure } from "../../shared/eligibility";
import type { Role } from "../../shared/pool";
import { ROSTER_STARTERS } from "../../shared/tournament";
import type { TournamentStatus } from "../../shared/tournament";
import type { Db } from "../db/client";
import { entryCredits, registrationPlayers, registrations, riotAccounts, teamMembers, teamRequests, teams } from "../db/schema";
import { formatRiotId } from "../../shared/riot-id";
import { paidUserIds } from "../tournaments/confirmations";
import { snapshotFromStored } from "../tournaments/registrations";
import { getTournamentBySlug } from "../tournaments/tournaments";
import { countPool, getPayingEntry, listPool } from "./pool";
import type { PoolFilter, PoolListing } from "./pool";
import { listOpenTeams } from "./requests";
import type { OpenTeam } from "./requests";

export type PoolPage = {
  tournament: {
    id: string;
    slug: string;
    title: string;
    edition: number;
    status: TournamentStatus;
    entryFeeArs: number;
    paymentInstructions: string;
    poolCount: number;
  };
  viewer:
    | { kind: "signed_out" }
    | { kind: "no_riot" }
    // Registration is over and the viewer is neither on a team nor in the pool.
    | { kind: "closed" }
    | { kind: "unpaid" }
    | { kind: "ineligible"; failures: EligibilityFailure[] }
    | { kind: "can_enter" }
    | {
        kind: "in_pool";
        entry: { roles: Role[]; autoPlace: boolean };
        openTeams: OpenTeam[];
        invites: { requestId: string; teamName: string }[];
        requests: { requestId: string; teamName: string }[];
      }
    | { kind: "placed"; team: { name: string; slug: string; captainRiotId: string; mates: string[]; autoFormed: boolean } }
    | { kind: "unplaced"; creditGranted: boolean };
  captain: { registrationId: string; teamName: string; missing: number; pool: PoolListing[] } | null;
};

async function placedTeam(db: Db, tournamentId: string, userId: string) {
  const [row] = await db
    .select({ team: teams, registrationId: registrations.id })
    .from(registrationPlayers)
    .innerJoin(registrations, eq(registrations.id, registrationPlayers.registrationId))
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(
      and(
        eq(registrationPlayers.tournamentId, tournamentId),
        eq(registrationPlayers.userId, userId),
        eq(registrationPlayers.active, true),
        notInArray(registrations.status, ["withdrawn", "dropped"]),
      ),
    );
  if (!row) return null;
  const riotIds = await db
    .select({ userId: teamMembers.userId, gameName: riotAccounts.gameName, tagLine: riotAccounts.tagLine })
    .from(teamMembers)
    .innerJoin(riotAccounts, eq(riotAccounts.userId, teamMembers.userId))
    .where(eq(teamMembers.teamId, row.team.id));
  const label = (userId: string) => {
    const account = riotIds.find((r) => r.userId === userId);
    return account ? formatRiotId(account) : "";
  };
  return {
    name: row.team.name,
    slug: row.team.slug,
    captainRiotId: label(row.team.captainUserId),
    mates: riotIds.filter((r) => r.userId !== userId).map((r) => formatRiotId(r)),
    autoFormed: row.team.autoFormedTournamentId === tournamentId,
  };
}

async function pendingPoolRequests(db: Db, tournamentId: string, userId: string) {
  const rows = await db
    .select({ id: teamRequests.id, kind: teamRequests.kind, teamName: teams.name })
    .from(teamRequests)
    .innerJoin(teams, eq(teams.id, teamRequests.teamId))
    .where(and(eq(teamRequests.tournamentId, tournamentId), eq(teamRequests.userId, userId), eq(teamRequests.status, "pending")));
  const pick = (kind: "invite" | "join_request") =>
    rows.filter((r) => r.kind === kind).map((r) => ({ requestId: r.id, teamName: r.teamName }));
  return { invites: pick("invite"), requests: pick("join_request") };
}

async function captainView(db: Db, tournamentId: string, viewerId: string, filter?: PoolFilter): Promise<PoolPage["captain"]> {
  const rows = await db
    .select({ registration: registrations, team: teams })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(and(eq(registrations.tournamentId, tournamentId), eq(registrations.status, "pending"), eq(teams.captainUserId, viewerId)));
  for (const { registration, team } of rows) {
    const starters = await db
      .select({ userId: registrationPlayers.userId })
      .from(registrationPlayers)
      .where(
        and(
          eq(registrationPlayers.registrationId, registration.id),
          eq(registrationPlayers.isSub, false),
          eq(registrationPlayers.active, true),
        ),
      );
    if (starters.length >= ROSTER_STARTERS) continue;
    return {
      registrationId: registration.id,
      teamName: team.name,
      missing: ROSTER_STARTERS - starters.length,
      pool: await listPool(db, tournamentId, filter),
    };
  }
  return null;
}

export async function getPoolPage(db: Db, slug: string, viewerId: string | null, filter?: PoolFilter): Promise<PoolPage | null> {
  const tournament = await getTournamentBySlug(db, slug);
  if (!tournament || tournament.status === "draft") return null;
  const summary = {
    id: tournament.id,
    slug: tournament.slug,
    title: tournament.title,
    edition: tournament.edition,
    status: tournament.status,
    entryFeeArs: tournament.entryFeeArs,
    // Free tournaments have nothing to pay, so their instructions never reach the page.
    paymentInstructions: tournament.entryFeeArs === 0 ? "" : tournament.paymentInstructions,
    poolCount: await countPool(db, tournament.id),
  };
  const page = (viewer: PoolPage["viewer"], captain: PoolPage["captain"] = null): PoolPage => ({ tournament: summary, viewer, captain });
  if (!viewerId) return page({ kind: "signed_out" });

  const placed = await placedTeam(db, tournament.id, viewerId);
  const captain = tournament.status === "registration_open" ? await captainView(db, tournament.id, viewerId, filter) : null;
  if (placed) return page({ kind: "placed", team: placed }, captain);

  const [account] = await db.select({ id: riotAccounts.id }).from(riotAccounts).where(eq(riotAccounts.userId, viewerId));
  if (!account) return page({ kind: "no_riot" }, captain);

  if (tournament.status !== "registration_open") {
    const [credit] = await db
      .select({ id: entryCredits.id })
      .from(entryCredits)
      .where(and(eq(entryCredits.userId, viewerId), eq(entryCredits.sourceTournamentId, tournament.id)));
    // Someone who paid and was left without a team gets their entry back as a credit.
    return page(credit ? { kind: "unplaced", creditGranted: true } : { kind: "closed" });
  }

  const entry = await getPayingEntry(db, tournament.id, viewerId);
  if (entry) {
    const { invites, requests } = await pendingPoolRequests(db, tournament.id, viewerId);
    return page(
      {
        kind: "in_pool",
        entry: { roles: entry.roles, autoPlace: entry.autoPlace },
        openTeams: await listOpenTeams(db, tournament.id, viewerId),
        invites,
        requests,
      },
      captain,
    );
  }
  if (tournament.entryFeeArs > 0 && !(await paidUserIds(db, tournament.id)).has(viewerId)) return page({ kind: "unpaid" }, captain);

  const taken = await snapshotFromStored(db, viewerId, tournament.rankSource, new Date());
  const failures = taken ? evaluatePlayerRules(tournament.eligibilityRules, taken.snapshot) : [];
  return page(failures.length > 0 ? { kind: "ineligible", failures } : { kind: "can_enter" }, captain);
}
