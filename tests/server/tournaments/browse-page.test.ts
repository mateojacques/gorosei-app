import { beforeEach, expect, test } from "bun:test";
import { loadBrowsePage } from "../../../src/server/tournaments/browse";
import { createTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

const NOW = new Date("2026-10-21T15:00:00Z");
const diamond = [{ id: "r", type: "player_rank_range" as const, max: { tier: "DIAMOND" as const, division: "IV" as const } }];

test("filters on the server, groups by section and echoes the filters", async () => {
  const open = await createTestTournament({ status: "registration_open", eligibilityRules: diamond });
  const live = await createTestTournament({ status: "live", eligibilityRules: diamond });
  await createTestTournament({ status: "registration_open" });
  const page = await loadBrowsePage(testDb, { rank: "DIAMOND" }, NOW);
  expect(page.filters).toEqual({ rank: "DIAMOND" });
  expect(page.upcoming.map((t) => t.slug)).toEqual([open.slug]);
  expect(page.live.map((t) => t.slug)).toEqual([live.slug]);
  expect(page.finished).toEqual([]);
  expect(page.hasAny).toBe(true);
});

test("hasAny is false on an empty database", async () => {
  const page = await loadBrowsePage(testDb, {}, NOW);
  expect(page).toEqual({ filters: {}, upcoming: [], live: [], finished: [], hasAny: false });
});

test("hasAny stays true when filters hide everything", async () => {
  await createTestTournament({ status: "registration_open" });
  const page = await loadBrowsePage(testDb, { format: "single_elimination" }, NOW);
  expect(page.upcoming).toEqual([]);
  expect(page.hasAny).toBe(true);
});
