import { expect, test } from "bun:test";
import { formatDateTime, t } from "../../src/shared/i18n";

test("t returns the es-AR message", () => {
  expect(t("rank.unranked")).toBe("Sin clasificar");
});

test("t interpolates params", () => {
  expect(t("registration.paidProgress", { paid: 3, total: 5 })).toBe("3/5 pagos");
});

test("formatDateTime renders in Buenos Aires time", () => {
  expect(formatDateTime(new Date("2026-10-26T21:00:00Z"))).toContain("18:00");
});

test("t leaves unknown placeholders intact", () => {
  expect(t("registration.paidProgress")).toContain("{paid}");
});

// @ts-expect-error unknown keys are a compile error
t("rank.unrankd");
