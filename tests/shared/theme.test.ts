import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { wcagContrast } from "culori";

const css = readFileSync(join(import.meta.dir, "../../src/styles.css"), "utf8");

function token(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(oklch\\([^)]*\\))`));
  if (!match?.[1]) throw new Error(`missing token --color-${name}`);
  return match[1];
}

const contrast = (fg: string, bg: string) => wcagContrast(fg, bg);

test("ink on surface is readable body text", () => {
  expect(contrast(token("ink"), token("surface"))).toBeGreaterThanOrEqual(4.5);
});

test("muted ink on surface is readable body text", () => {
  expect(contrast(token("ink-muted"), token("surface"))).toBeGreaterThanOrEqual(4.5);
});

test("light cobalt on surface is readable body text", () => {
  expect(contrast(token("cobalt-light"), token("surface"))).toBeGreaterThanOrEqual(4.5);
});

test("white on signal red works for the large CTA label", () => {
  expect(contrast("white", token("signal"))).toBeGreaterThanOrEqual(3);
});

test("ink on cobalt works for the large caption-bar text", () => {
  expect(contrast(token("ink"), token("cobalt"))).toBeGreaterThanOrEqual(3);
});
