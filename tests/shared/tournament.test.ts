import { expect, test } from "bun:test";
import { tournamentInputSchema } from "../../src/shared/tournament";

const valid = {
  title: "Copa Semanal LAS",
  edition: 1,
  startsAt: "2026-11-01T20:00:00Z",
  registrationClosesAt: "2026-10-30T20:00:00Z",
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

test("accepts a full valid input", () => {
  expect(tournamentInputSchema.safeParse(valid).success).toBe(true);
});

test("rejects registration closing at or after start", () => {
  expect(tournamentInputSchema.safeParse({ ...valid, registrationClosesAt: valid.startsAt }).success).toBe(false);
});

test("rejects a prize split not summing to 100", () => {
  expect(tournamentInputSchema.safeParse({ ...valid, prizeSplit: [60, 30] }).success).toBe(false);
});

test("rejects more than 2 subs", () => {
  expect(tournamentInputSchema.safeParse({ ...valid, maxSubs: 3 }).success).toBe(false);
});

test("registration must close at least an hour before the start", () => {
  const closes = (iso: string) => tournamentInputSchema.safeParse({ ...valid, registrationClosesAt: iso }).success;
  expect(closes("2026-11-01T19:30:00Z")).toBe(false);
  expect(closes("2026-11-01T19:00:00Z")).toBe(true);
});
