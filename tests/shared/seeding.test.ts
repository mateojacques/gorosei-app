import { expect, test } from "bun:test";
import type { Rank } from "../../src/shared/rank";
import { seedOrder } from "../../src/shared/seeding";

const r = (tier: Rank["tier"], division: Rank["division"] = "IV"): Rank => ({ tier, division, lp: 0 });
const team = (id: string, ranks: (Rank | null)[], at = "2026-10-01T00:00:00Z") => ({
  id,
  ranks,
  registeredAt: new Date(at),
});

test("higher average rank seeds first", () => {
  const out = seedOrder([team("low", [r("SILVER")]), team("high", [r("GOLD"), r("PLATINUM")])]);
  expect(out.map((x) => x.id)).toEqual(["high", "low"]);
});

test("a null rank counts as the lowest tier", () => {
  const out = seedOrder([team("mixed", [null, r("GOLD")]), team("gold", [r("GOLD"), r("GOLD")])]);
  expect(out.map((x) => x.id)).toEqual(["gold", "mixed"]);
});

test("equal averages order by registration time", () => {
  const out = seedOrder([
    team("late", [r("GOLD")], "2026-10-02T00:00:00Z"),
    team("early", [r("GOLD")], "2026-10-01T00:00:00Z"),
  ]);
  expect(out.map((x) => x.id)).toEqual(["early", "late"]);
});

test("an empty rank list sorts last and the input is not mutated", () => {
  const input = [team("empty", []), team("iron", [r("IRON")])];
  const out = seedOrder(input);
  expect(out.map((x) => x.id)).toEqual(["iron", "empty"]);
  expect(input.map((x) => x.id)).toEqual(["empty", "iron"]);
});
