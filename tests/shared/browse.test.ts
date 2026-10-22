import { expect, test } from "bun:test";
import { browseSearchSchema, filterTournaments, groupForBrowse, rankBracketOf } from "../../src/shared/browse";
import type { BrowseTournament } from "../../src/shared/browse";
import type { TournamentStatus } from "../../src/shared/tournament";

const NOW = new Date("2026-10-21T15:00:00Z"); // Wednesday, 12:00 ART

type Row = Pick<BrowseTournament, "startsAt" | "bracket" | "rankBracket"> & { id: string };
const row = (id: string, at: string, extra: Partial<Row> = {}): Row => ({
  id,
  startsAt: new Date(at),
  bracket: "double_elimination",
  rankBracket: "open",
  ...extra,
});
const ids = (list: Row[]) => list.map((r) => r.id);

test("rank bracket is the lowest max tier among player rank ranges", () => {
  expect(rankBracketOf([])).toBe("open");
  expect(rankBracketOf([{ id: "a", type: "player_rank_range", min: { tier: "GOLD", division: "IV" } }])).toBe("open");
  expect(rankBracketOf([{ id: "a", type: "team_average_max", max: { tier: "GOLD", division: "IV" } }])).toBe("open");
  expect(rankBracketOf([{ id: "a", type: "player_rank_range", max: { tier: "DIAMOND", division: "IV" } }])).toBe("DIAMOND");
  expect(
    rankBracketOf([
      { id: "a", type: "player_rank_range", max: { tier: "EMERALD", division: "I" } },
      { id: "b", type: "player_rank_range", max: { tier: "PLATINUM", division: "II" } },
    ]),
  ).toBe("PLATINUM");
});

test("today keeps the rest of the ART day", () => {
  const list = [row("late", "2026-10-22T02:59:00Z"), row("tomorrow", "2026-10-22T03:00:00Z")];
  expect(ids(filterTournaments(list, { when: "today" }, NOW))).toEqual(["late"]);
});

test("week keeps today and the next six ART days", () => {
  const list = [
    row("today", "2026-10-21T20:00:00Z"),
    row("day7", "2026-10-28T02:59:00Z"),
    row("day8", "2026-10-28T03:00:00Z"),
    row("yesterday", "2026-10-21T02:59:00Z"),
  ];
  expect(ids(filterTournaments(list, { when: "week" }, NOW))).toEqual(["today", "day7"]);
});

test("weekend keeps the coming Saturday and Sunday in ART", () => {
  const list = [
    row("fri", "2026-10-24T02:59:00Z"),
    row("sat", "2026-10-24T21:00:00Z"),
    row("sun", "2026-10-26T02:59:00Z"),
    row("mon", "2026-10-26T03:00:00Z"),
  ];
  expect(ids(filterTournaments(list, { when: "weekend" }, NOW))).toEqual(["sat", "sun"]);
  const saturdayNoon = new Date("2026-10-24T15:00:00Z");
  expect(ids(filterTournaments([row("satMorning", "2026-10-24T12:00:00Z")], { when: "weekend" }, saturdayNoon))).toEqual([
    "satMorning",
  ]);
});

test("format and rank filters combine with AND", () => {
  const list = [
    row("a", "2026-10-22T20:00:00Z", { bracket: "single_elimination", rankBracket: "GOLD" }),
    row("b", "2026-10-22T20:00:00Z", { bracket: "single_elimination", rankBracket: "DIAMOND" }),
    row("c", "2026-10-22T20:00:00Z", { bracket: "double_elimination", rankBracket: "GOLD" }),
  ];
  expect(ids(filterTournaments(list, { format: "single_elimination", rank: "GOLD" }, NOW))).toEqual(["a"]);
  expect(ids(filterTournaments(list, {}, NOW))).toEqual(["a", "b", "c"]);
});

test("search schema drops unknown values instead of failing", () => {
  expect(browseSearchSchema.parse({ when: "yesterday", rank: "GOLD" })).toStrictEqual({ rank: "GOLD" });
  expect(browseSearchSchema.parse({ when: "weekend", format: "single_elimination", rank: "open" })).toStrictEqual({
    when: "weekend",
    format: "single_elimination",
    rank: "open",
  });
  expect(browseSearchSchema.parse({ format: 3 })).toStrictEqual({});
});

test("groups upcoming by start, live, and finished newest first, dropping drafts and cancelled", () => {
  const t = (id: string, status: TournamentStatus, at: string) => ({ id, status, startsAt: new Date(at) });
  const groups = groupForBrowse(
    [
      t("open2", "registration_open", "2026-10-30T20:00:00Z"),
      t("open1", "check_in", "2026-10-21T20:00:00Z"),
      t("closed", "registration_closed", "2026-10-25T20:00:00Z"),
      t("live", "live", "2026-10-21T14:00:00Z"),
      t("old", "finished", "2026-10-01T20:00:00Z"),
      t("recent", "finished", "2026-10-15T20:00:00Z"),
      t("draft", "draft", "2026-10-22T20:00:00Z"),
      t("cancelled", "cancelled", "2026-10-22T20:00:00Z"),
    ],
    NOW,
  );
  expect(groups.upcoming.map((x) => x.id)).toEqual(["open1", "closed", "open2"]);
  expect(groups.live.map((x) => x.id)).toEqual(["live"]);
  expect(groups.finished.map((x) => x.id)).toEqual(["recent", "old"]);
});
