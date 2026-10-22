import { describe, expect, test } from "bun:test";
import {
  EngineError,
  applyResult,
  bracketComplete,
  createBracket,
  finalStandings,
  listEngineMatches,
  resetMatchResult,
} from "../../../src/server/bracket/engine";

const seeds = (n: number) => Array.from({ length: n }, (_, i) => `r${i + 1}`);
const playable = (data: Parameters<typeof listEngineMatches>[0]) =>
  listEngineMatches(data).filter((m) => m.status !== "archived");

describe("createBracket", () => {
  test("double elimination for 8 teams", async () => {
    const { data } = await createBracket("double_elimination", seeds(8));
    const all = listEngineMatches(data);
    expect(all.length).toBe(15);
    expect(new Set(all.map((m) => m.phase))).toEqual(new Set(["winners", "losers", "grand_final", "reset"]));
    expect(all.filter((m) => m.phase === "grand_final").length).toBe(1);
    expect(all.filter((m) => m.phase === "reset").length).toBe(1);
    const first = all.filter((m) => m.phase === "winners" && m.round === 1);
    expect(first.length).toBe(4);
    expect(first.map((m) => [m.team1, m.team2].sort().join("-"))).toContain("r1-r8");
    expect(first.every((m) => m.status === "ready")).toBe(true);
  });

  test("single elimination for 4 teams has a third-place match", async () => {
    const { data } = await createBracket("single_elimination", seeds(4));
    const all = listEngineMatches(data);
    expect(all.length).toBe(4);
    expect(all.map((m) => m.phase).sort()).toEqual(["final", "main", "main", "third_place"]);
  });

  test("single elimination with 2 teams is just a final", async () => {
    const { data } = await createBracket("single_elimination", seeds(2));
    expect(listEngineMatches(data).map((m) => m.phase)).toEqual(["final"]);
  });

  for (const type of ["single_elimination", "double_elimination"] as const) {
    test(`5 teams get byes (${type})`, async () => {
      const { data } = await createBracket(type, seeds(5));
      const all = listEngineMatches(data);
      const firstRound = all.filter((m) => m.round === 1 && (m.phase === "main" || m.phase === "winners"));
      expect(firstRound.filter((m) => m.status === "ready").length).toBe(1);
      expect(firstRound.filter((m) => m.status === "archived").length).toBe(3);
      expect(all.some((m) => m.status === "ready" && (m.team1 === null || m.team2 === null))).toBe(false);
    });
  }
});

describe("applyResult", () => {
  test("advances the winner", async () => {
    const { data } = await createBracket("single_elimination", seeds(4));
    const m = playable(data).find((x) => x.status === "ready" && x.team1 && x.team2)!;
    const next = await applyResult(data, m.id, { score1: 1, score2: 0 });
    const final = listEngineMatches(next).find((x) => x.phase === "final")!;
    expect([final.team1, final.team2]).toContain(m.team1);
    expect(listEngineMatches(next).find((x) => x.id === m.id)!.winner).toBe(m.team1);
  });

  test("a forfeit is a walkover for the other team", async () => {
    const { data } = await createBracket("single_elimination", seeds(4));
    const m = playable(data).find((x) => x.status === "ready")!;
    const next = await applyResult(data, m.id, { forfeit: 2 });
    const final = listEngineMatches(next).find((x) => x.phase === "final")!;
    expect([final.team1, final.team2]).toContain(m.team1);
    expect([final.team1, final.team2]).not.toContain(m.team2);
  });
});

async function playDoubleUntilGrandFinal(): Promise<{ data: Awaited<ReturnType<typeof createBracket>>["data"]; stageId: number }> {
  let { data, stageId } = await createBracket("double_elimination", seeds(4));
  // lower seed number always wins: r1 takes the winners bracket
  for (let guard = 0; guard < 20; guard++) {
    const m = listEngineMatches(data).find(
      (x) => x.status === "ready" && x.team1 && x.team2 && x.phase !== "grand_final" && x.phase !== "reset",
    );
    if (!m) break;
    const t1Wins = Number(m.team1!.slice(1)) < Number(m.team2!.slice(1));
    data = await applyResult(data, m.id, t1Wins ? { score1: 1, score2: 0 } : { score1: 0, score2: 1 });
  }
  return { data, stageId };
}

describe("grand final", () => {
  test("a winners-side win completes the bracket with no reset", async () => {
    const { data } = await playDoubleUntilGrandFinal();
    const gf = listEngineMatches(data).find((m) => m.phase === "grand_final")!;
    expect(gf.status).toBe("ready");
    expect(gf.team1).toBe("r1");
    const done = await applyResult(data, gf.id, { score1: 1, score2: 0 });
    const reset = listEngineMatches(done).find((m) => m.phase === "reset")!;
    expect(reset.status).toBe("archived");
    expect(bracketComplete(done)).toBe(true);
  });

  test("a losers-side win opens the reset", async () => {
    const { data } = await playDoubleUntilGrandFinal();
    const gf = listEngineMatches(data).find((m) => m.phase === "grand_final")!;
    const after = await applyResult(data, gf.id, { score1: 0, score2: 1 });
    const reset = listEngineMatches(after).find((m) => m.phase === "reset")!;
    expect(reset.status).toBe("ready");
    expect(bracketComplete(after)).toBe(false);
    const done = await applyResult(after, reset.id, { score1: 1, score2: 0 });
    expect(bracketComplete(done)).toBe(true);
  });
});

describe("resetMatchResult", () => {
  test("undoes a result while the next match has not started, refuses afterwards", async () => {
    const { data } = await createBracket("single_elimination", seeds(4));
    const [a, b] = playable(data).filter((x) => x.phase === "main");
    const one = await applyResult(data, a!.id, { score1: 1, score2: 0 });
    const undone = await resetMatchResult(one, a!.id);
    const reopened = listEngineMatches(undone).find((x) => x.id === a!.id)!;
    expect(reopened.winner).toBeNull();
    expect(["ready", "running"]).toContain(reopened.status);

    const two = await applyResult(one, b!.id, { score1: 1, score2: 0 });
    const finalMatch = listEngineMatches(two).find((x) => x.phase === "final")!;
    const three = await applyResult(two, finalMatch.id, { score1: 1, score2: 0 });
    await expect(resetMatchResult(three, a!.id)).rejects.toBeInstanceOf(EngineError);
    await expect(resetMatchResult(three, a!.id)).rejects.toMatchObject({ code: "next_match_started" });
  });
});

test("finalStandings ranks a finished 4-team single-elimination bracket", async () => {
  let { data, stageId } = await createBracket("single_elimination", seeds(4));
  for (let guard = 0; guard < 10; guard++) {
    const m = listEngineMatches(data).find((x) => x.status === "ready" && x.team1 && x.team2);
    if (!m) break;
    data = await applyResult(data, m.id, { score1: 1, score2: 0 });
  }
  expect(bracketComplete(data)).toBe(true);
  const standings = await finalStandings(data, stageId);
  expect(standings.map((s) => s.rank).sort()).toEqual([1, 2, 3, 4]);
  expect(standings.find((s) => s.rank === 1)?.registrationId).toBeDefined();
});
