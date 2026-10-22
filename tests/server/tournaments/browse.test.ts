import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { registrations } from "../../../src/server/db/schema";
import { listBrowseTournaments } from "../../../src/server/tournaments/browse";
import { confirmedTestTeam, createTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

test("drafts and cancelled tournaments are not listed", async () => {
  await createTestTournament({ status: "draft" });
  await createTestTournament({ status: "cancelled" });
  const open = await createTestTournament({ status: "registration_open" });
  const list = await listBrowseTournaments(testDb);
  expect(list.map((t) => t.slug)).toEqual([open.slug]);
});

test("confirmedCount counts only confirmed registrations", async () => {
  const t = await createTestTournament({ status: "registration_open", entryFeeArs: 0 });
  await confirmedTestTeam(t.id, "a");
  const b = await confirmedTestTeam(t.id, "b");
  await testDb.update(registrations).set({ status: "withdrawn" }).where(eq(registrations.id, b.registrationId));
  const other = await createTestTournament({ status: "registration_open" });
  const list = await listBrowseTournaments(testDb);
  expect(list.find((x) => x.slug === t.slug)!.confirmedCount).toBe(1);
  expect(list.find((x) => x.slug === other.slug)!.confirmedCount).toBe(0);
});

test("rank bracket follows the eligibility rules", async () => {
  const t = await createTestTournament({
    status: "registration_open",
    eligibilityRules: [{ id: "r", type: "player_rank_range", max: { tier: "DIAMOND", division: "IV" } }],
  });
  const [row] = await listBrowseTournaments(testDb);
  expect(row!.slug).toBe(t.slug);
  expect(row!.rankBracket).toBe("DIAMOND");
  expect(row!.bracket).toBe("double_elimination");
  expect(row!.prizeSplit).toEqual([70, 30]);
});

test("only the 12 most recent finished tournaments come back, with every other one", async () => {
  const finished = [];
  for (let i = 0; i < 15; i++) {
    finished.push(
      await createTestTournament({
        status: "finished",
        startsAt: new Date(Date.UTC(2026, 8, 1 + i, 20)),
        registrationClosesAt: new Date(Date.UTC(2026, 8, 1 + i, 10)),
      }),
    );
  }
  const open = await createTestTournament({ status: "registration_open" });
  const live = await createTestTournament({ status: "live" });
  const list = await listBrowseTournaments(testDb);
  const slugs = new Set(list.map((t) => t.slug));
  expect(list.filter((t) => t.status === "finished")).toHaveLength(12);
  for (const old of finished.slice(0, 3)) expect(slugs.has(old.slug)).toBe(false);
  for (const recent of finished.slice(3)) expect(slugs.has(recent.slug)).toBe(true);
  expect(slugs.has(open.slug)).toBe(true);
  expect(slugs.has(live.slug)).toBe(true);
});
