import { expect, test } from "bun:test";
import { placementLabel } from "../../src/shared/placement";

test("placement labels follow the rank once the tournament is over", () => {
  expect(placementLabel(1, "finished")).toEqual({ key: "placement.champion" });
  expect(placementLabel(2, "finished")).toEqual({ key: "placement.second" });
  expect(placementLabel(3, "finished")).toEqual({ key: "placement.third" });
  expect(placementLabel(7, "finished")).toEqual({ key: "placement.nth", n: 7 });
  expect(placementLabel(null, "finished")).toEqual({ key: "placement.none" });
  expect(placementLabel(null, "cancelled")).toEqual({ key: "placement.none" });
});

test("any tournament still running is in progress", () => {
  for (const status of ["registration_open", "registration_closed", "check_in", "live"] as const) {
    expect(placementLabel(null, status)).toEqual({ key: "placement.inProgress" });
    expect(placementLabel(1, status)).toEqual({ key: "placement.inProgress" });
  }
});
