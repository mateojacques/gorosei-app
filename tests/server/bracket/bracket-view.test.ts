import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { matches, user } from "../../../src/server/db/schema";
import { getBracketView } from "../../../src/server/bracket/bracket-view";
import { confirmMatch } from "../../../src/server/matchday/moderation";
import { createTestTournament, startedTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

async function moderator() {
  await createTestUser("mod");
  await testDb.update(user).set({ role: "moderator" }).where(eq(user.id, "mod"));
  return "mod";
}

const rows = (tournamentId: string) => testDb.select().from(matches).where(eq(matches.tournamentId, tournamentId));

test("5-team double elimination: byes in round 1 carry one team and no match id; seeds follow seed order", async () => {
  const s = await startedTestTournament(5);
  const view = (await getBracketView(testDb, s.tournament.id))!;
  expect(view.bracket).toBe("double_elimination");
  const round1 = view.matches.filter((m) => m.phase === "winners" && m.round === 1);
  const byes = round1.filter((m) => m.bye);
  // 5 teams in an 8-slot bracket: three byes, one played match.
  expect(byes).toHaveLength(3);
  for (const bye of byes) {
    expect(bye.matchId).toBeNull();
    expect(bye.slots.filter((slot) => slot.registrationId !== null)).toHaveLength(1);
  }
  const seedOf = new Map(s.teams.map((t, i) => [t.registrationId, i + 1]));
  for (const m of view.matches) {
    for (const slot of m.slots) {
      if (slot.registrationId) {
        expect(slot.seed).toBe(seedOf.get(slot.registrationId)!);
        expect(slot.name).toBeTruthy();
      }
    }
  }
  expect(byes.find((b) => b.slots.some((slot) => slot.seed === 1))).toBeDefined();

  const stored = await rows(s.tournament.id);
  const open = view.matches.filter((m) => m.status === "open");
  expect(open.length).toBeGreaterThan(0);
  for (const m of open) expect(stored.find((r) => r.id === m.matchId)!.status).toBe("open");
  // Losers-bracket ghosts (bye against bye) are not shown.
  for (const m of view.matches) if (m.bye) expect(m.slots.some((slot) => slot.registrationId)).toBe(true);
});

test("completed matches carry scores and winner flags", async () => {
  const mod = await moderator();
  const s = await startedTestTournament(4, { bracket: "single_elimination" });
  const first = (await rows(s.tournament.id)).find((m) => m.status === "open")!;
  expect((await confirmMatch(testDb, mod, first.id, { score1: 1, score2: 0 })).ok).toBe(true);
  const view = (await getBracketView(testDb, s.tournament.id))!;
  const done = view.matches.find((m) => m.matchId === first.id)!;
  expect(done.status).toBe("completed");
  expect(done.slots.map((slot) => [slot.registrationId, slot.score, slot.winner])).toEqual([
    [first.reg1Id, 1, true],
    [first.reg2Id, 0, false],
  ]);
});

test("no stored bracket → null", async () => {
  const t = await createTestTournament({ status: "live" });
  expect(await getBracketView(testDb, t.id)).toBeNull();
});

test("2-team single elimination is one final; 3 teams get no third-place match", async () => {
  const two = await startedTestTournament(2, { bracket: "single_elimination" });
  const v2 = (await getBracketView(testDb, two.tournament.id))!;
  expect(v2.matches.map((m) => m.phase)).toEqual(["final"]);
  expect(v2.matches[0]!.bestOf).toBe(3);
  await resetTestDb();
  const three = await startedTestTournament(3, { bracket: "single_elimination" });
  const v3 = (await getBracketView(testDb, three.tournament.id))!;
  expect(v3.matches.some((m) => m.phase === "third_place")).toBe(false);
  expect(v3.matches.filter((m) => m.bye)).toHaveLength(1);
});

test("a finished double elimination without a needed reset hides the reset and still renders", async () => {
  const mod = await moderator();
  const s = await startedTestTournament(4, { finalsBestOf: 1 });
  const seed = new Map(s.teams.map((t, i) => [t.registrationId, i]));
  for (let guard = 0; guard < 20; guard++) {
    const next = (await rows(s.tournament.id)).find((m) => m.status === "open" && m.reg1Id && m.reg2Id);
    if (!next) break;
    const better = seed.get(next.reg1Id!)! < seed.get(next.reg2Id!)!;
    expect((await confirmMatch(testDb, mod, next.id, better ? { score1: 1, score2: 0 } : { score1: 0, score2: 1 })).ok).toBe(true);
  }
  const view = (await getBracketView(testDb, s.tournament.id))!;
  expect(view.matches.some((m) => m.phase === "reset")).toBe(false);
  const gf = view.matches.find((m) => m.phase === "grand_final")!;
  expect(gf.status).toBe("completed");
  expect(gf.slots.find((slot) => slot.winner)!.registrationId).toBe(s.teams[0]!.registrationId);
});
