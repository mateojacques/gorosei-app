import { expect, test } from "bun:test";
import { layoutBracket } from "../../src/shared/bracket-layout";
import type { BracketViewMatch } from "../../src/shared/bracket-layout";
import type { MatchPhase } from "../../src/shared/match";

const slot = (name: string | null) => ({ registrationId: name, name, seed: null, score: null, winner: false });
const m = (phase: MatchPhase, round: number, number: number, extra: Partial<BracketViewMatch> = {}): BracketViewMatch => ({
  matchId: `${phase}-${round}-${number}`,
  phase,
  round,
  number,
  bye: false,
  status: "waiting",
  bestOf: 1,
  slots: [slot(null), slot(null)],
  ...extra,
});

test("8-team single elimination: quarterfinal, semifinal, final, then third place", () => {
  const matches = [
    m("third_place", 1, 1),
    m("final", 3, 1),
    m("main", 2, 2),
    m("main", 2, 1),
    ...[4, 3, 2, 1].map((n) => m("main", 1, n)),
  ];
  const sections = layoutBracket(matches);
  expect(sections.map((s) => s.id)).toEqual(["main", "third_place"]);
  const main = sections[0]!;
  expect(main.rounds.map((r) => r.title.key)).toEqual([
    "bracket.round.quarterfinal",
    "bracket.round.semifinal",
    "bracket.round.final",
  ]);
  expect(main.rounds.map((r) => r.round)).toEqual([1, 2, 3]);
  expect(main.rounds[0]!.matches.map((x) => x.number)).toEqual([1, 2, 3, 4]);
  expect(main.rounds[1]!.matches.map((x) => x.number)).toEqual([1, 2]);
  expect(sections[1]!.rounds[0]!.title.key).toBe("bracket.round.thirdPlace");
});

test("double elimination: winners, losers, grand final", () => {
  const matches = [
    m("reset", 2, 1),
    m("grand_final", 1, 1),
    m("losers", 2, 1),
    m("losers", 1, 1),
    m("winners", 3, 1),
    m("winners", 2, 1),
    m("winners", 1, 2),
    m("winners", 1, 1),
    m("losers", 3, 1),
  ];
  const sections = layoutBracket(matches);
  expect(sections.map((s) => s.id)).toEqual(["winners", "losers", "grand_final"]);
  expect(sections[0]!.rounds.map((r) => r.title.key)).toEqual([
    "bracket.round.quarterfinal",
    "bracket.round.semifinal",
    "bracket.round.final",
  ]);
  expect(sections[1]!.rounds.map((r) => r.title)).toEqual([
    { key: "bracket.round.numbered", n: 1 },
    { key: "bracket.round.numbered", n: 2 },
    { key: "bracket.round.numbered", n: 3 },
  ]);
  expect(sections[2]!.rounds.map((r) => r.title.key)).toEqual(["bracket.round.grandFinal", "bracket.round.reset"]);
});

test("long winners brackets number the early rounds", () => {
  const matches = [1, 2, 3, 4].map((r) => m("winners", r, 1));
  expect(layoutBracket(matches)[0]!.rounds.map((r) => r.title)).toEqual([
    { key: "bracket.round.numbered", n: 1 },
    { key: "bracket.round.quarterfinal", n: 2 },
    { key: "bracket.round.semifinal", n: 3 },
    { key: "bracket.round.final", n: 4 },
  ]);
});

test("empty sections are omitted and byes are kept", () => {
  const sections = layoutBracket([m("main", 1, 1, { bye: true, matchId: null }), m("final", 2, 1)]);
  expect(sections.map((s) => s.id)).toEqual(["main"]);
  expect(sections[0]!.rounds[0]!.matches[0]!.bye).toBe(true);
  expect(layoutBracket([])).toEqual([]);
});

test("2-team single elimination is a single final", () => {
  const sections = layoutBracket([m("final", 1, 1)]);
  expect(sections).toHaveLength(1);
  expect(sections[0]!.rounds.map((r) => r.title.key)).toEqual(["bracket.round.final"]);
});
