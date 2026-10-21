import { expect, test } from "bun:test";
import { featuredCup } from "../../src/shared/featured-cup";
import { isTier } from "../../src/shared/rank";

test("featured cup config is well-formed", () => {
  expect(featuredCup.prizeArs).toBeGreaterThan(0);
  expect(featuredCup.entryFeeArs).toBeGreaterThan(0);
  expect(featuredCup.teamCap).toBeGreaterThan(0);
  expect(Number.isNaN(featuredCup.startsAt.getTime())).toBe(false);
  expect(isTier(featuredCup.rankCap)).toBe(true);
});

test("featured cup does not claim registration is open by default", () => {
  expect(featuredCup.status).toBe("upcoming");
});
