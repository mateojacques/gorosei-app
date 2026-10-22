import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BracketView } from "../../src/components/bracket/bracket-view";
import type { BracketViewMatch } from "../../src/shared/bracket-layout";
import type { MatchPhase, MatchStatus } from "../../src/shared/match";

let nextId = 0;
const slot = (name: string | null, seed: number | null = null, extra: { score?: number; winner?: boolean } = {}) => ({
  registrationId: name ? `reg-${name}` : null,
  name,
  seed,
  score: extra.score ?? null,
  winner: extra.winner ?? false,
});
const m = (phase: MatchPhase, round: number, number: number, status: MatchStatus, slots: BracketViewMatch["slots"], extra: Partial<BracketViewMatch> = {}): BracketViewMatch => ({
  matchId: `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
  phase,
  round,
  number,
  bye: false,
  status,
  bestOf: 1,
  slots,
  ...extra,
});

const LONG = "Los Invencibles del Sur!"; // 24 characters

const matches: BracketViewMatch[] = [
  m("winners", 1, 1, "completed", [slot("Alfa", 1, { score: 1, winner: true }), slot("Hotel", 8, { score: 0 })]),
  m("winners", 1, 2, "completed", [slot("Delta", 4, { score: 0 }), slot("Echo", 5, { score: 1, winner: true })]),
  m("winners", 1, 3, "in_progress", [slot("Bravo", 2), slot(LONG, 7)]),
  m("winners", 1, 4, "completed", [slot("Charlie", 3), slot(null)], { bye: true, matchId: null }),
  m("winners", 2, 1, "open", [slot("Alfa", 1), slot("Echo", 5)]),
  m("winners", 2, 2, "waiting", [slot("Charlie", 3), slot(null)]),
  m("winners", 3, 1, "waiting", [slot(null), slot(null)], { matchId: null }),
  m("losers", 1, 1, "open", [slot("Hotel", 8), slot("Delta", 4)]),
  m("losers", 2, 1, "waiting", [slot(null), slot(null)], { matchId: null }),
  m("grand_final", 1, 1, "waiting", [slot(null), slot(null)], { matchId: null }),
];

const html = renderToStaticMarkup(<BracketView bracket="double_elimination" matches={matches} highlightRegistrationId={`reg-${LONG}`} />);

test("renders winners, losers and grand final sections with an anchor nav", () => {
  for (const id of ["winners", "losers", "grand_final"]) {
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain(`href="#${id}"`);
  }
  expect(html.indexOf('id="winners"')).toBeLessThan(html.indexOf('id="losers"'));
});

test("every match with an id links to its match page; byes and empty matches do not", () => {
  for (const match of matches) {
    if (match.matchId) expect(html).toContain(`href="/partidas/${match.matchId}"`);
  }
  expect((html.match(/href="\/partidas\//g) ?? []).length).toBe(matches.filter((x) => x.matchId).length);
});

test("byes, empty slots, in-play and long names", () => {
  expect(html).toContain("Pasa por bye");
  expect(html).toContain("A definir");
  expect(html).toContain("En juego");
  expect(html).toContain("[overflow-wrap:anywhere]");
  expect(html).toContain(LONG);
});

test("the viewer's team is marked with text and underline", () => {
  expect(html).toContain("Tu equipo");
  expect(html).toMatch(/class="[^"]*underline[^"]*"[^>]*>Los Invencibles del Sur!/);
});

test("rounds scroll inside a labelled region; columns, not a card grid; no red", () => {
  expect(html).toMatch(/role="region"[^>]*aria-label="[^"]+"[^>]*tabindex="0"|tabindex="0"[^>]*role="region"/);
  expect(html).not.toMatch(/grid-cols-/);
  expect(html).not.toContain("bg-signal");
});

test("single elimination with a third-place match", () => {
  const single = renderToStaticMarkup(
    <BracketView
      bracket="single_elimination"
      matches={[
        m("main", 1, 1, "completed", [slot("Alfa", 1, { score: 1, winner: true }), slot("Delta", 4, { score: 0 })]),
        m("main", 1, 2, "completed", [slot("Bravo", 2, { score: 0 }), slot("Charlie", 3, { score: 1, winner: true })]),
        m("final", 2, 1, "open", [slot("Alfa", 1), slot("Charlie", 3)]),
        m("third_place", 1, 1, "open", [slot("Delta", 4), slot("Bravo", 2)]),
      ]}
    />,
  );
  expect(single).toContain('id="main"');
  expect(single).toContain('id="third_place"');
  expect(single).toContain("Tercer puesto");
  expect(single).toContain("Final");
});
