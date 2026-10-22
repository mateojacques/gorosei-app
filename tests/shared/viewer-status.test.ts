import { expect, test } from "bun:test";
import { statusChecklist } from "../../src/shared/viewer-status";

const base = { riotLinked: false, free: false, inPool: false, registration: null, tournamentStatus: "registration_open" as const, checkedIn: false };

test("a player with nothing yet has every step to do", () => {
  expect(statusChecklist(base)).toEqual([
    { id: "riot", state: "todo" },
    { id: "team", state: "todo" },
    { id: "payment", state: "todo" },
  ]);
});

test("a partial roster and partial payment are pending with progress", () => {
  expect(
    statusChecklist({ ...base, riotLinked: true, registration: { starters: 4, paid: 3, status: "pending" } }),
  ).toEqual([
    { id: "riot", state: "done" },
    { id: "team", state: "pending", progress: { have: 4, need: 5 } },
    { id: "payment", state: "pending", progress: { have: 3, need: 5 } },
  ]);
});

test("a confirmed registration is done everywhere", () => {
  expect(
    statusChecklist({ ...base, riotLinked: true, registration: { starters: 5, paid: 0, status: "confirmed" } }).map((s) => s.state),
  ).toEqual(["done", "done", "done"]);
  expect(
    statusChecklist({ ...base, riotLinked: true, registration: { starters: 5, paid: 5, status: "pending" } }).find((s) => s.id === "payment"),
  ).toEqual({ id: "payment", state: "done" });
});

test("a free tournament has no payment step", () => {
  expect(statusChecklist({ ...base, free: true }).map((s) => s.id)).toEqual(["riot", "team"]);
});

test("check-in appears from check-in on", () => {
  const reg = { starters: 5, paid: 5, status: "confirmed" as const };
  expect(statusChecklist({ ...base, riotLinked: true, registration: reg, tournamentStatus: "registration_closed" }).map((s) => s.id)).not.toContain(
    "check_in",
  );
  expect(statusChecklist({ ...base, riotLinked: true, registration: reg, tournamentStatus: "check_in" }).at(-1)).toEqual({
    id: "check_in",
    state: "pending",
  });
  expect(statusChecklist({ ...base, riotLinked: true, registration: reg, tournamentStatus: "live", checkedIn: true }).at(-1)).toEqual({
    id: "check_in",
    state: "done",
  });
});

test("a pool player waiting for a team is pending", () => {
  const steps = statusChecklist({ ...base, riotLinked: true, inPool: true });
  expect(steps.find((s) => s.id === "team")).toEqual({ id: "team", state: "pending" });
  // Entering the pool requires the entry to be paid.
  expect(steps.find((s) => s.id === "payment")).toEqual({ id: "payment", state: "done" });
});
