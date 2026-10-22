import { expect, test } from "bun:test";
import {
  bestOfFor,
  expectedMatchMinutes,
  isDelayed,
  reportInputSchema,
  validateScore,
} from "../../src/shared/match";

test("validateScore accepts only a decided series", () => {
  expect(validateScore(1, 1, 0)).toBe(true);
  expect(validateScore(1, 1, 1)).toBe(false);
  expect(validateScore(1, 0, 0)).toBe(false);
  expect(validateScore(1, 2, 0)).toBe(false);
  expect(validateScore(3, 2, 1)).toBe(true);
  expect(validateScore(3, 3, 0)).toBe(false);
  expect(validateScore(3, 2, 2)).toBe(false);
  expect(validateScore(5, 3, 2)).toBe(true);
});

const base = { own: 1, opponent: 0, screenshotUrl: "https://i.imgur.com/a.png", riotMatchIds: ["LA2_123"] };

test("reportInputSchema checks screenshot and Riot IDs", () => {
  expect(reportInputSchema.safeParse(base).success).toBe(true);
  expect(reportInputSchema.safeParse({ ...base, screenshotUrl: null }).success).toBe(true);
  expect(reportInputSchema.safeParse({ ...base, screenshotUrl: "http://x.com/a.png" }).success).toBe(false);
  expect(reportInputSchema.safeParse({ ...base, riotMatchIds: ["LA2_1", "LA2_2", "LA2_3", "LA2_4"] }).success).toBe(false);
  expect(reportInputSchema.safeParse({ ...base, riotMatchIds: ["LA1_123"] }).success).toBe(false);
  expect(reportInputSchema.safeParse({ ...base, riotMatchIds: ["LA2_abc"] }).success).toBe(false);
});

test("bestOfFor uses finalsBestOf for finals", () => {
  const t = { bestOf: 1, finalsBestOf: 3 } as const;
  for (const p of ["grand_final", "reset", "final"] as const) expect(bestOfFor(t, p)).toBe(3);
  for (const p of ["winners", "losers", "main", "third_place"] as const) expect(bestOfFor(t, p)).toBe(1);
});

test("a match is delayed 15 minutes past its expected length", () => {
  const opened = new Date("2026-11-01T20:00:00Z");
  expect(expectedMatchMinutes(1)).toBe(45);
  expect(expectedMatchMinutes(3)).toBe(75);
  expect(expectedMatchMinutes(5)).toBe(105);
  expect(isDelayed(opened, 1, new Date("2026-11-01T20:59:00Z"))).toBe(false);
  expect(isDelayed(opened, 1, new Date("2026-11-01T21:01:00Z"))).toBe(true);
  expect(isDelayed(null, 1, new Date("2030-01-01T00:00:00Z"))).toBe(false);
});
