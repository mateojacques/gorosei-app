import { expect, test } from "bun:test";
import { compareRanks, formatRank, maxRank, rankValue } from "../../src/shared/rank";

test("rankValue orders tiers and divisions", () => {
  expect(rankValue({ tier: "IRON", division: "IV", lp: 0 })).toBe(0);
  expect(rankValue({ tier: "DIAMOND", division: "I", lp: 0 })).toBe(27);
  expect(rankValue({ tier: "MASTER", division: "I", lp: 0 })).toBe(28);
  expect(rankValue({ tier: "GRANDMASTER", division: "I", lp: 0 })).toBe(29);
  expect(rankValue({ tier: "CHALLENGER", division: "I", lp: 0 })).toBe(30);
});

test("rankValue ignores LP", () => {
  expect(rankValue({ tier: "GOLD", division: "II", lp: 99 })).toBe(rankValue({ tier: "GOLD", division: "II", lp: 0 }));
});

test("compareRanks sorts unranked lowest", () => {
  expect(compareRanks(null, { tier: "IRON", division: "IV", lp: 0 })).toBeLessThan(0);
  expect(compareRanks({ tier: "IRON", division: "IV", lp: 0 }, null)).toBeGreaterThan(0);
  expect(compareRanks(null, null)).toBe(0);
});

test("maxRank breaks ties by LP", () => {
  const best = maxRank([
    { tier: "GOLD", division: "II", lp: 10 },
    { tier: "GOLD", division: "II", lp: 50 },
    null,
  ]);
  expect(best).toEqual({ tier: "GOLD", division: "II", lp: 50 });
});

test("maxRank of only unranked entries is null", () => {
  expect(maxRank([null, null])).toBeNull();
  expect(maxRank([])).toBeNull();
});

test("formatRank renders es-AR labels", () => {
  expect(formatRank({ tier: "DIAMOND", division: "I", lp: 0 })).toBe("Diamante I");
  expect(formatRank({ tier: "MASTER", division: "I", lp: 120 })).toBe("Maestro");
  expect(formatRank(null)).toBe("Sin clasificar");
});
