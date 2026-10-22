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
