import { expect, test } from "bun:test";
import { fromArtDateTimeLocal, toArtDateTimeLocal } from "../../src/shared/art-datetime";

test("fromArtDateTimeLocal reads the value as Buenos Aires time (UTC−03:00)", () => {
  expect(fromArtDateTimeLocal("2026-11-07T18:00").toISOString()).toBe("2026-11-07T21:00:00.000Z");
  expect(fromArtDateTimeLocal("2026-11-07T23:30").toISOString()).toBe("2026-11-08T02:30:00.000Z");
});

test("toArtDateTimeLocal is the inverse, for datetime-local inputs", () => {
  expect(toArtDateTimeLocal(new Date("2026-11-07T21:00:00.000Z"))).toBe("2026-11-07T18:00");
  expect(toArtDateTimeLocal(new Date("2026-11-08T02:30:00.000Z"))).toBe("2026-11-07T23:30");
});

test("a malformed value is an invalid date, not a guess", () => {
  expect(Number.isNaN(fromArtDateTimeLocal("mañana").getTime())).toBe(true);
});
