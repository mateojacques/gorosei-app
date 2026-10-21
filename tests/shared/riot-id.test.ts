import { expect, test } from "bun:test";
import { formatRiotId, parseRiotId, riotIdToSlug, slugToRiotId } from "../../src/shared/riot-id";

test("parseRiotId keeps spaces and accents", () => {
  expect(parseRiotId("Señor Café#LAS")).toEqual({ gameName: "Señor Café", tagLine: "LAS" });
});

test("parseRiotId splits on the last # and trims", () => {
  expect(parseRiotId("  a#b#1234 ")).toEqual({ gameName: "a#b", tagLine: "1234" });
});

test("parseRiotId rejects malformed input", () => {
  expect(parseRiotId("nohash")).toBeNull();
  expect(parseRiotId("#LAS")).toBeNull();
  expect(parseRiotId("name#")).toBeNull();
  expect(parseRiotId("name#LA")).toBeNull();
  expect(parseRiotId("name#LASXYZ")).toBeNull();
  expect(parseRiotId("abcdefghijklmnopq#LAS")).toBeNull();
});

test("formatRiotId joins with #", () => {
  expect(formatRiotId({ gameName: "Señor Café", tagLine: "LAS" })).toBe("Señor Café#LAS");
});

test("slug round-trips Riot IDs containing dashes, spaces and accents", () => {
  for (const id of [
    { gameName: "a-b", tagLine: "1234" },
    { gameName: "Señor Café", tagLine: "LAS" },
  ]) {
    expect(slugToRiotId(riotIdToSlug(id))).toEqual(id);
  }
});

test("slugToRiotId rejects slugs without a tag", () => {
  expect(slugToRiotId("nodash")).toBeNull();
  expect(slugToRiotId("%E0%A4%A")).toBeNull();
});
