import { expect, test } from "bun:test";
import { slugify } from "../../src/shared/slug";

test("lowercases and hyphenates", () => {
  expect(slugify("Copa Semanal LAS")).toBe("copa-semanal-las");
});

test("strips accents, punctuation and edges", () => {
  expect(slugify("  Los Pibes del Café!! ")).toBe("los-pibes-del-cafe");
});
