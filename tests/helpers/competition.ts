import { createTournament } from "../../src/server/tournaments/tournaments";
import { tournaments } from "../../src/server/db/schema";
import { eq } from "drizzle-orm";
import type { TournamentInput, TournamentStatus } from "../../src/shared/tournament";
import { createTestUser, testDb } from "./db";

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
