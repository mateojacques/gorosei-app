import { createTestTournament } from "../../tests/helpers/competition";

/** The open Copa Semanal the landing page features: Saturday 7/11 at 18:00 ART, $300.000 to the champion. */
export async function seedLandingTournament() {
  return createTestTournament({
    title: "Copa Semanal LAS",
    edition: 1,
    status: "registration_open",
    prizeGoalArs: 300000,
    prizeSplit: [100],
    entryFeeArs: 5000,
    startsAt: new Date("2026-11-07T21:00:00Z"),
    registrationClosesAt: new Date("2026-11-06T21:00:00Z"),
    eligibilityRules: [{ id: "r1", type: "player_rank_range", max: { tier: "DIAMOND", division: "IV" } }],
  });
}

/**
 * Three cups, one per stage of the tournament page, plus a draft that must never show:
 * an open cup (Saturday 7/11), a live single-elimination cup with one semifinal played and one in play,
 * and a finished double-elimination cup with standings, a VOD and paid entries.
 */
export async function seedStageTournaments() {
  const { eq } = await import("drizzle-orm");
  const { testDb } = await import("../../tests/helpers/db");
  const { brackets, matches, tournaments, user } = await import("../../src/server/db/schema");
  const { confirmMatch } = await import("../../src/server/matchday/moderation");
  const { createTestUser } = await import("../../tests/helpers/db");
  const { payFor, startedTestTournament } = await import("../../tests/helpers/competition");

  const open = await createTestTournament({
    title: "Copa Abierta",
    status: "registration_open",
    entryFeeArs: 5000,
    prizeGoalArs: 300000,
    prizeSplit: [70, 30],
    startsAt: new Date("2026-11-07T21:00:00Z"),
    registrationClosesAt: new Date("2026-11-06T21:00:00Z"),
    paymentInstructions: "Transferí al alias gorosei.copa.",
    streamUrl: "https://www.twitch.tv/gorosei",
  });
  const draft = await createTestTournament({ title: "Copa Secreta", status: "draft" });

  await createTestUser("stage-mod");
  await testDb.update(user).set({ role: "moderator" }).where(eq(user.id, "stage-mod"));

  const live = await startedTestTournament(
    4,
    {
      title: "Copa En Vivo",
      bracket: "single_elimination",
      streamUrl: "https://www.twitch.tv/gorosei",
      startsAt: new Date("2026-10-20T21:00:00Z"),
      registrationClosesAt: new Date("2026-10-19T21:00:00Z"),
    },
    "lv",
  );
  const liveMatches = await testDb.select().from(matches).where(eq(matches.tournamentId, live.tournament.id));
  const [played, playing] = liveMatches.filter((m) => m.status === "open");
  await confirmMatch(testDb, "stage-mod", played!.id, { score1: 1, score2: 0 });
  await testDb.update(matches).set({ status: "in_progress" }).where(eq(matches.id, playing!.id));
  await testDb.update(tournaments).set({ status: "live" }).where(eq(tournaments.id, live.tournament.id));

  const finished = await startedTestTournament(
    4,
    {
      title: "Copa Terminada",
      startsAt: new Date("2026-10-10T21:00:00Z"),
      registrationClosesAt: new Date("2026-10-09T21:00:00Z"),
      prizeSplit: [70, 30],
    },
    "fn",
  );
  // Paid entries after the fact: 4 teams × 5 starters × $5.000 = $100.000, $70.000 to the champion.
  await testDb.update(tournaments).set({ status: "finished", entryFeeArs: 5000 }).where(eq(tournaments.id, finished.tournament.id));
  for (const team of finished.teams) for (const id of team.starters) await payFor(finished.tournament.id, id);
  await testDb
    .update(brackets)
    .set({
      finalStandings: [
        { registrationId: finished.teams[0]!.registrationId, rank: 1 },
        { registrationId: finished.teams[1]!.registrationId, rank: 2 },
        { registrationId: finished.teams[2]!.registrationId, rank: 3 },
        { registrationId: finished.teams[3]!.registrationId, rank: 4 },
      ],
    })
    .where(eq(brackets.tournamentId, finished.tournament.id));
  const [vodMatch] = (await testDb.select().from(matches).where(eq(matches.tournamentId, finished.tournament.id))).filter((m) => m.reg1Id && m.reg2Id);
  await testDb.update(matches).set({ vodUrl: "https://www.youtube.com/watch?v=final" }).where(eq(matches.id, vodMatch!.id));

  return { open, draft, live, liveCompletedMatchId: played!.id, finished };
}
