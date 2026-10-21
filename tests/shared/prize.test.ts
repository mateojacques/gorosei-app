import { expect, test } from "bun:test";
import { prizePoolArs, splitPrize } from "../../src/shared/prize";

test("splits a pool by percentage", () => {
  expect(splitPrize(300000, [70, 30])).toEqual([210000, 90000]);
});

test("remainder goes to first place", () => {
  expect(splitPrize(100001, [70, 30])).toEqual([70001, 30000]);
});

test("pool is paid entries times fee", () => {
  expect(prizePoolArs(15, 5000)).toBe(75000);
});
