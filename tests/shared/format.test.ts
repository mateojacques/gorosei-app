import { expect, test } from "bun:test";
import { formatArs, formatCupDay, formatCupTime, formatLongDate } from "../../src/shared/format";

test("formatArs uses es-AR thousands separators and no decimals", () => {
  expect(formatArs(300000)).toBe("$300.000");
  expect(formatArs(1000000)).toBe("$1.000.000");
});

test("cup day and time render in Buenos Aires time", () => {
  const start = new Date("2026-11-07T21:00:00Z");
  expect(formatCupDay(start)).toBe("SÁB 7/11");
  expect(formatCupTime(start)).toBe("18:00");
});

test("cup day follows the ART day boundary, not UTC", () => {
  const lateSaturday = new Date("2026-11-08T02:00:00Z");
  expect(formatCupDay(lateSaturday)).toBe("SÁB 7/11");
  expect(formatCupTime(lateSaturday)).toBe("23:00");
});

test("formatLongDate spells the ART calendar date", () => {
  expect(formatLongDate(new Date("2026-10-22T01:00:00Z"))).toBe("21 de octubre de 2026");
});
