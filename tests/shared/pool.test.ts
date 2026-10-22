import { expect, test } from "bun:test";
import { poolEntryInputSchema } from "../../src/shared/pool";

test("poolEntryInputSchema rejects empty, duplicate and unknown roles", () => {
  expect(poolEntryInputSchema.safeParse({ roles: [] }).success).toBe(false);
  expect(poolEntryInputSchema.safeParse({ roles: ["mid", "mid"] }).success).toBe(false);
  expect(poolEntryInputSchema.safeParse({ roles: ["mid", "adc"] }).success).toBe(false);
  expect(poolEntryInputSchema.safeParse({ roles: ["top", "jungle", "mid", "bot", "support", "top"] }).success).toBe(false);
});

test("poolEntryInputSchema accepts ordered roles and defaults autoPlace to true", () => {
  const parsed = poolEntryInputSchema.parse({ roles: ["mid", "top"] });
  expect(parsed).toEqual({ roles: ["mid", "top"], autoPlace: true });
  expect(poolEntryInputSchema.parse({ roles: ["bot"], autoPlace: false }).autoPlace).toBe(false);
});
