import { beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { differenceEuclidean, parse, toGamut } from "culori";
import { OG_COLORS, ogTitleFontSize, renderDefaultOg, renderTournamentOg, tournamentOgResponse } from "../../../src/server/seo/og";
import { createTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function expectPng(bytes: Uint8Array) {
  expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // IHDR is the first chunk: width and height are at bytes 16 and 20.
  expect(view.getUint32(16)).toBe(1200);
  expect(view.getUint32(20)).toBe(630);
}

const upcoming = (title: string, prize = 210000) => ({
  kind: "upcoming" as const,
  title,
  edition: 12,
  startsAt: new Date("2026-11-07T21:00:00Z"),
  status: "registration_open" as const,
  championPrizeArs: prize,
});

test("renders a 1200×630 PNG for an upcoming tournament and the site default", async () => {
  expectPng(await renderTournamentOg(upcoming("Copa Semanal LAS")));
  expectPng(await renderDefaultOg());
}, 30_000);

test("hostile and long titles, a free prize and a missing champion render", async () => {
  expectPng(await renderTournamentOg(upcoming("A".repeat(80))));
  expectPng(await renderTournamentOg(upcoming(`<b>Copa & "Ñandú" 'Acción' 🔥</b>`, 0)));
  expectPng(await renderTournamentOg({ kind: "finished", title: "Copa", edition: 3, champion: null, championPrizeArs: 0 }));
  expectPng(await renderTournamentOg({ kind: "finished", title: "Copa", edition: 3, champion: "Los Pibes del Barrio Sur", championPrizeArs: 90000 }));
}, 60_000);

test("title size shrinks with length and never drops below 56", () => {
  let previous = Number.POSITIVE_INFINITY;
  for (let length = 1; length <= 200; length++) {
    const size = ogTitleFontSize(length);
    expect(size).toBeLessThanOrEqual(previous);
    expect(size).toBeGreaterThanOrEqual(56);
    previous = size;
  }
});

test("hex colors match the design tokens", () => {
  const css = readFileSync(join(import.meta.dir, "../../../src/styles.css"), "utf8");
  const token = (name: string) => css.match(new RegExp(`--color-${name}:\\s*(oklch\\([^)]*\\))`))![1]!;
  const distance = differenceEuclidean("oklab");
  // Cobalt sits just outside sRGB; compare against the token mapped into sRGB, as a browser shows it.
  const inGamut = toGamut("rgb", "oklch");
  for (const [name, hex] of Object.entries(OG_COLORS)) {
    expect(distance(inGamut(parse(token(name))!), parse(hex)!)).toBeLessThan(0.01);
  }
});

test("the route serves public tournaments only", async () => {
  await resetTestDb();
  const draft = await createTestTournament({ status: "draft" });
  const open = await createTestTournament({ status: "registration_open" });
  expect((await tournamentOgResponse(testDb, `${draft.slug}.png`)).status).toBe(404);
  expect((await tournamentOgResponse(testDb, "nope.png")).status).toBe(404);
  expect((await tournamentOgResponse(testDb, open.slug)).status).toBe(404);
  const res = await tournamentOgResponse(testDb, `${open.slug}.png`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/png");
  expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  expectPng(new Uint8Array(await res.arrayBuffer()));
}, 30_000);
