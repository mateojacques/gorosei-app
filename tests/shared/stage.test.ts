import { expect, test } from "bun:test";
import { tournamentSchedule, tournamentStage } from "../../src/shared/stage";

test("stage follows the tournament status", () => {
  expect(tournamentStage("draft")).toBeNull();
  expect(tournamentStage("registration_open")).toBe("before");
  expect(tournamentStage("registration_closed")).toBe("before");
  expect(tournamentStage("check_in")).toBe("before");
  expect(tournamentStage("live")).toBe("live");
  expect(tournamentStage("finished")).toBe("after");
  expect(tournamentStage("cancelled")).toBe("after");
});

test("schedule lists registration close, check-in window and start in order", () => {
  const rows = tournamentSchedule({
    registrationClosesAt: new Date("2026-11-01T18:00:00Z"),
    startsAt: new Date("2026-11-01T20:00:00Z"),
  });
  expect(rows.map((r) => [r.key, r.at.toISOString()])).toEqual([
    ["registrationCloses", "2026-11-01T18:00:00.000Z"],
    ["checkInOpens", "2026-11-01T19:00:00.000Z"],
    ["checkInCloses", "2026-11-01T19:50:00.000Z"],
    ["starts", "2026-11-01T20:00:00.000Z"],
  ]);
});
