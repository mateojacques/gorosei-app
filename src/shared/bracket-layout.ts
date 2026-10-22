import type { MatchPhase, MatchStatus } from "./match";

export type BracketSlot = { registrationId: string | null; name: string | null; seed: number | null; score: number | null; winner: boolean };

export type BracketViewMatch = {
  matchId: string | null;
  phase: MatchPhase;
  round: number;
  number: number;
  bye: boolean;
  status: MatchStatus;
  bestOf: 1 | 3 | 5;
  slots: [BracketSlot, BracketSlot];
};

export type RoundTitle = {
  key:
    | "bracket.round.final"
    | "bracket.round.semifinal"
    | "bracket.round.quarterfinal"
    | "bracket.round.numbered"
    | "bracket.round.grandFinal"
    | "bracket.round.reset"
    | "bracket.round.thirdPlace";
  n: number;
};

export type BracketSectionId = "winners" | "losers" | "grand_final" | "main" | "third_place";

export type BracketSection = {
  id: BracketSectionId;
  rounds: { round: number; title: RoundTitle; matches: BracketViewMatch[] }[];
};

const SECTION_ORDER: BracketSectionId[] = ["winners", "losers", "grand_final", "main", "third_place"];

const SECTION_OF: Record<MatchPhase, BracketSectionId> = {
  winners: "winners",
  losers: "losers",
  grand_final: "grand_final",
  reset: "grand_final",
  main: "main",
  final: "main",
  third_place: "third_place",
};

function roundTitle(section: BracketSectionId, round: number, lastRound: number): RoundTitle {
  if (section === "grand_final") return { key: round === 1 ? "bracket.round.grandFinal" : "bracket.round.reset", n: round };
  if (section === "third_place") return { key: "bracket.round.thirdPlace", n: round };
  if (section === "losers") return { key: "bracket.round.numbered", n: round };
  const fromEnd = lastRound - round;
  if (fromEnd === 0) return { key: "bracket.round.final", n: round };
  if (fromEnd === 1) return { key: "bracket.round.semifinal", n: round };
  if (fromEnd === 2) return { key: "bracket.round.quarterfinal", n: round };
  return { key: "bracket.round.numbered", n: round };
}

export function layoutBracket(matches: BracketViewMatch[]): BracketSection[] {
  const bySection = new Map<BracketSectionId, Map<number, BracketViewMatch[]>>();
  for (const match of matches) {
    const id = SECTION_OF[match.phase];
    const rounds = bySection.get(id) ?? new Map<number, BracketViewMatch[]>();
    const list = rounds.get(match.round) ?? [];
    list.push(match);
    rounds.set(match.round, list);
    bySection.set(id, rounds);
  }
  const sections: BracketSection[] = [];
  for (const id of SECTION_ORDER) {
    const rounds = bySection.get(id);
    if (!rounds) continue;
    const numbers = [...rounds.keys()].sort((a, b) => a - b);
    const last = numbers[numbers.length - 1]!;
    sections.push({
      id,
      rounds: numbers.map((round) => ({
        round,
        title: roundTitle(id, round, last),
        matches: [...rounds.get(round)!].sort((a, b) => a.number - b.number),
      })),
    });
  }
  return sections;
}
