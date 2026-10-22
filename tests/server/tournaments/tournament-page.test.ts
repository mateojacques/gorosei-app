import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { brackets, tournaments } from "../../../src/server/db/schema";
import { loadTournamentPage } from "../../../src/server/tournaments/tournament-page";
import { createTestTournament, startedTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

const NOW = new Date("2026-10-22T15:00:00Z");
const later = { startsAt: new Date("2026-12-05T21:00:00Z"), registrationClosesAt: new Date("2026-12-04T21:00:00Z") };

test("registration open: no bracket, no results, the schedule in order", async () => {
  const t = await createTestTournament({ status: "registration_open", streamUrl: "https://www.twitch.tv/gorosei" });
  const page = (await loadTournamentPage(testDb, t.slug, null, NOW))!;
  expect(page.stage).toBe("before");
  expect(page.bracketView).toBeNull();
  expect(page.results).toBeNull();
  expect(page.next).toBeNull();
  expect(page.viewerStatus).toBeNull();
  expect(page.schedule.map((r) => r.key)).toEqual(["registrationCloses", "checkInOpens", "checkInCloses", "starts"]);
  expect(page.streamChannel).toBe("gorosei");
});

test("live with a stored bracket carries the bracket and the channel", async () => {
  const s = await startedTestTournament(4, { streamUrl: "https://twitch.tv/Gorosei/" });
  const page = (await loadTournamentPage(testDb, s.tournament.slug, null, NOW))!;
  expect(page.stage).toBe("live");
  expect(page.bracketView!.matches.length).toBeGreaterThan(0);
  expect(page.streamChannel).toBe("Gorosei");
});

test("live without a brackets row does not throw", async () => {
  const t = await createTestTournament({ status: "live", streamUrl: "javascript:alert(1)" });
  const page = (await loadTournamentPage(testDb, t.slug, null, NOW))!;
  expect(page.stage).toBe("live");
  expect(page.bracketView).toBeNull();
  expect(page.streamChannel).toBeNull();
});

test("finished with standings has a champion and the next cup", async () => {
  const s = await startedTestTournament(4);
  await testDb.update(tournaments).set({ status: "finished" }).where(eq(tournaments.id, s.tournament.id));
  await testDb
    .update(brackets)
    .set({ finalStandings: [{ registrationId: s.teams[1]!.registrationId, rank: 1 }] })
    .where(eq(brackets.tournamentId, s.tournament.id));
  const next = await createTestTournament({ status: "registration_open", ...later });
  const page = (await loadTournamentPage(testDb, s.tournament.slug, null, NOW))!;
  expect(page.stage).toBe("after");
  expect(page.results!.champion!.registrationId).toBe(s.teams[1]!.registrationId);
  expect(page.next!.slug).toBe(next.slug);
  expect(page.bracketView).not.toBeNull();
});

test("finished without standings has no champion", async () => {
  const t = await createTestTournament({ status: "finished" });
  const page = (await loadTournamentPage(testDb, t.slug, null, NOW))!;
  expect(page.results).toEqual({ champion: null, podium: [], vods: [] });
});

test("cancelled has no results but points at the next cup", async () => {
  const t = await createTestTournament({ status: "cancelled" });
  const next = await createTestTournament({ status: "registration_open", ...later });
  const page = (await loadTournamentPage(testDb, t.slug, null, NOW))!;
  expect(page.stage).toBe("after");
  expect(page.results).toBeNull();
  expect(page.bracketView).toBeNull();
  expect(page.next!.slug).toBe(next.slug);
});

test("a signed-in viewer gets their status before the cup and their registration once live", async () => {
  const open = await createTestTournament({ status: "registration_open" });
  const { linkedPlayer } = await import("../../helpers/competition");
  await linkedPlayer("viewer");
  const before = (await loadTournamentPage(testDb, open.slug, { userId: "viewer" }, NOW))!;
  expect(before.viewerStatus).toEqual({ riotLinked: true, inPool: false, registration: null, checkedIn: false });

  const s = await startedTestTournament(2);
  const live = (await loadTournamentPage(testDb, s.tournament.slug, { userId: s.teams[0]!.captain }, NOW))!;
  expect(live.viewerRegistrationId).toBe(s.teams[0]!.registrationId);
});

test("a draft slug is not found", async () => {
  const t = await createTestTournament({ status: "draft" });
  expect(await loadTournamentPage(testDb, t.slug, null, NOW)).toBeNull();
  expect(await loadTournamentPage(testDb, "nope", null, NOW)).toBeNull();
});
