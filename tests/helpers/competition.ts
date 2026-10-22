import { createTournament } from "../../src/server/tournaments/tournaments";
import { createTeam } from "../../src/server/teams/teams";
import { registerTeam } from "../../src/server/tournaments/registrations";
import type { RosterInput } from "../../src/server/tournaments/registrations";
import { enterPool } from "../../src/server/pool/pool";
import type { Role } from "../../src/shared/pool";
import { checkIns, entryPayments, rankSnapshots, registrations, riotAccounts, teamMembers, teams, tournaments } from "../../src/server/db/schema";
import type { Rank } from "../../src/shared/rank";
import { eq } from "drizzle-orm";
import type { TournamentInput, TournamentStatus } from "../../src/shared/tournament";
import { createTestRiotAccount, createTestUser, testDb } from "./db";
import { FakeRiotClient } from "./fake-riot";

export const baseTournamentInput: TournamentInput = {
  title: "Copa Semanal LAS",
  edition: 1,
  startsAt: new Date("2026-11-01T20:00:00Z"),
  registrationClosesAt: new Date("2026-10-30T20:00:00Z"),
  bracket: "double_elimination",
  draftMode: "tournament_draft",
  bestOf: 1,
  finalsBestOf: 3,
  teamCap: 16,
  maxSubs: 1,
  subsCountForTeamRules: false,
  rankSource: "peak_season",
  eligibilityRules: [],
  entryFeeArs: 5000,
  prizeGoalArs: 300000,
  prizeSplit: [70, 30],
  paymentInstructions: "",
  rulesText: "",
  streamUrl: "",
};

let counter = 0;
let tagCounter = 0;

export async function createTestTournament(overrides: Partial<TournamentInput> & { status?: TournamentStatus } = {}) {
  const { status, ...input } = overrides;
  const admin = await createTestUser(`test-admin-${++counter}-${crypto.randomUUID()}`);
  const created = await createTournament(testDb, admin, {
    ...baseTournamentInput,
    edition: counter + 1000,
    ...input,
  });
  if (status) await testDb.update(tournaments).set({ status }).where(eq(tournaments.id, created.id));
  const [row] = await testDb.select().from(tournaments).where(eq(tournaments.id, created.id));
  return row!;
}

export async function linkedPlayer(
  id: string,
  rank: Rank | null = null,
  opts: { level?: number; games?: number } = {},
): Promise<string> {
  const accountId = await createTestRiotAccount(id, { puuid: `puuid-${id}`, gameName: id, tagLine: "LAS" });
  await testDb.update(riotAccounts).set({ summonerLevel: opts.level ?? 30 }).where(eq(riotAccounts.id, accountId));
  await testDb.insert(rankSnapshots).values({
    riotAccountId: accountId,
    tier: rank?.tier ?? null,
    division: rank?.division ?? null,
    lp: rank?.lp ?? null,
    wins: opts.games ?? 0,
    losses: 0,
    observedAt: new Date(),
  });
  return id;
}

export async function createTestTeam(
  captainId: string,
  memberIds: string[] = [],
  name = `Equipo ${++counter}`,
): Promise<{ id: string; slug: string }> {
  const created = await createTeam(testDb, captainId, { name, tag: `T${(++tagCounter).toString(36).toUpperCase()}` });
  if (!created.ok) throw new Error(`createTestTeam failed: ${created.reason}`);
  if (memberIds.length > 0) {
    await testDb.insert(teamMembers).values(memberIds.map((userId) => ({ teamId: created.teamId, userId, role: "member" as const })));
  }
  return { id: created.teamId, slug: created.slug };
}

/** Registers the team through registerTeam as its captain; the tournament must be open. */
export async function createTestRegistration(tournamentId: string, teamId: string, roster: RosterInput): Promise<string> {
  const [team] = await testDb.select({ captainUserId: teams.captainUserId }).from(teams).where(eq(teams.id, teamId));
  if (!team) throw new Error(`createTestRegistration: unknown team ${teamId}`);
  const result = await registerTeam({ db: testDb, riot: new FakeRiotClient() }, team.captainUserId, tournamentId, teamId, roster);
  if (!result.ok) throw new Error(`createTestRegistration failed: ${result.reason}`);
  return result.registrationId;
}

/** Inserts a live entry payment for the player, as an admin marking it paid would. */
export async function payFor(tournamentId: string, userId: string): Promise<void> {
  await testDb.insert(entryPayments).values({ tournamentId, userId, source: "payment", reference: "test", recordedBy: userId });
}

/** Links a player, pays their entry and puts them in the tournament's pool. */
export async function poolPlayer(
  tournament: { id: string },
  id: string,
  rank: Rank | null = null,
  roles: Role[] = ["mid"],
  opts: { autoPlace?: boolean } = {},
): Promise<string> {
  await linkedPlayer(id, rank);
  await payFor(tournament.id, id);
  const result = await enterPool({ db: testDb, riot: new FakeRiotClient() }, id, tournament.id, {
    roles,
    autoPlace: opts.autoPlace ?? true,
  });
  if (!result.ok) throw new Error(`poolPlayer failed: ${result.reason}`);
  return id;
}

/**
 * A confirmed team of five starters `${prefix}1..5` plus sub `${prefix}6`, registered through registerTeam.
 * The tournament must be open for registration and free (entryFeeArs 0) so the roster confirms without payments.
 */
export async function confirmedTestTeam(tournamentId: string, prefix: string, rank: Rank | null = null) {
  const ids: string[] = [];
  for (let i = 1; i <= 6; i++) ids.push(await linkedPlayer(`${prefix}${i}`, rank));
  const team = await createTestTeam(ids[0]!, ids.slice(1));
  const registrationId = await createTestRegistration(tournamentId, team.id, { starters: ids.slice(0, 5), subs: [ids[5]!] });
  return { ids, starters: ids.slice(0, 5), sub: ids[5]!, captain: ids[0]!, teamId: team.id, registrationId };
}

/** A confirmed team (see confirmedTestTeam) with its first `checkedIn` players checked in. */
export async function checkedInTestTeam(
  tournament: { id: string },
  prefix: string,
  checkedIn: number,
  opts: { rank?: Rank | null; decision?: "play" | "withdraw" } = {},
) {
  const team = await confirmedTestTeam(tournament.id, prefix, opts.rank ?? null);
  if (checkedIn > 0) {
    await testDb
      .insert(checkIns)
      .values(team.ids.slice(0, checkedIn).map((userId) => ({ registrationId: team.registrationId, userId, tournamentId: tournament.id })));
  }
  if (opts.decision) await testDb.update(registrations).set({ checkInDecision: opts.decision }).where(eq(registrations.id, team.registrationId));
  return team;
}

/**
 * A live tournament: `teamCount` teams checked in fully (team i has the i-th best rank, so seed order is index order),
 * check-in closed and the bracket started.
 */
export async function startedTestTournament(teamCount: number, overrides: Partial<TournamentInput> = {}) {
  const tournament = await createTestTournament({ status: "registration_open", entryFeeArs: 0, rankSource: "current", ...overrides });
  const tiers = ["CHALLENGER", "GRANDMASTER", "MASTER", "DIAMOND", "EMERALD", "PLATINUM", "GOLD", "SILVER", "BRONZE", "IRON"] as const;
  const teams = [];
  for (let i = 0; i < teamCount; i++) {
    teams.push(await checkedInTestTeam(tournament, `s${i}p`, 6, { rank: { tier: tiers[i % tiers.length]!, division: "I", lp: 0 } }));
  }
  await testDb.update(tournaments).set({ status: "check_in" }).where(eq(tournaments.id, tournament.id));
  const { closeCheckIn } = await import("../../src/server/matchday/check-in");
  const closed = await closeCheckIn(testDb, tournament.id, new Date(tournament.startsAt.getTime() - 5 * 60_000), null, { force: true });
  if (!closed.ok) throw new Error(`startedTestTournament failed: ${closed.reason}`);
  return { tournament, teams, closed };
}
