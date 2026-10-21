import { createTournament } from "../../src/server/tournaments/tournaments";
import { createTeam } from "../../src/server/teams/teams";
import { rankSnapshots, riotAccounts, teamMembers, tournaments } from "../../src/server/db/schema";
import type { Rank } from "../../src/shared/rank";
import { eq } from "drizzle-orm";
import type { TournamentInput, TournamentStatus } from "../../src/shared/tournament";
import { createTestRiotAccount, createTestUser, testDb } from "./db";

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
