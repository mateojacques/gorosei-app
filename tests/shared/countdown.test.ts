import { expect, test } from "bun:test";
import { formatCountdown, getCountdown } from "../../src/shared/countdown";

const now = new Date("2026-10-22T13:47:21Z");
const startsAt = new Date(now.getTime() + ((16 * 24 + 4) * 3600 + 12 * 60 + 39) * 1000);

test("getCountdown splits the remaining time", () => {
  expect(getCountdown(now, startsAt)).toEqual({ days: 16, hours: 4, minutes: 12, seconds: 39 });
});

test("formatCountdown pads hours and minutes", () => {
  expect(formatCountdown({ days: 16, hours: 4, minutes: 12, seconds: 39 })).toBe("16d 04h 12m");
});

test("getCountdown is null at and after the start", () => {
  expect(getCountdown(startsAt, startsAt)).toBeNull();
  expect(getCountdown(new Date(startsAt.getTime() + 1000), startsAt)).toBeNull();
});
