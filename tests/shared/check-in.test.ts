import { expect, test } from "bun:test";
import { checkInOutcome, checkInWindow } from "../../src/shared/check-in";

test("check-in opens an hour before and closes ten minutes before start", () => {
  const w = checkInWindow(new Date("2026-11-01T20:00:00Z"));
  expect(w.opensAt.toISOString()).toBe("2026-11-01T19:00:00.000Z");
  expect(w.closesAt.toISOString()).toBe("2026-11-01T19:50:00.000Z");
});

test("outcome follows the checked-in count and the captain's decision", () => {
  expect(checkInOutcome(5, null)).toBe("in");
  expect(checkInOutcome(7, null)).toBe("in");
  expect(checkInOutcome(4, null)).toBe("short_handed");
  expect(checkInOutcome(4, "play")).toBe("short_handed");
  expect(checkInOutcome(4, "withdraw")).toBe("withdrawn");
  expect(checkInOutcome(3, null)).toBe("short_handed");
  expect(checkInOutcome(2, "play")).toBe("forfeit");
  expect(checkInOutcome(0, null)).toBe("forfeit");
  expect(checkInOutcome(5, "withdraw")).toBe("in");
});
