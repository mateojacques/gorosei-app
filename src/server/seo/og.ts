import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import type { ReactNode } from "react";
import satori from "satori";
import { formatArs, formatCupDay, formatCupTime } from "../../shared/format";
import { t } from "../../shared/i18n";
import type { TournamentStatus } from "../../shared/tournament";
import type { Db } from "../db/client";
import { getTournamentView } from "../tournaments/tournament-view";

const WIDTH = 1200;
const HEIGHT = 630;

/** The DESIGN.md tokens as hex: satori cannot read oklch. Checked against styles.css in tests. */
export const OG_COLORS = {
  surface: "#050a0d",
  line: "#243036",
  ink: "#eff2f4",
  "ink-muted": "#9ca7ac",
  cobalt: "#006e9b",
  "cobalt-light": "#59c5f5",
  signal: "#df2225",
} as const;
const C = OG_COLORS;

export type OgInput =
  | { kind: "upcoming"; title: string; edition: number; startsAt: Date; status: TournamentStatus; championPrizeArs: number }
  | { kind: "finished"; title: string; edition: number; champion: string | null; championPrizeArs: number };

const MAX_TITLE_SIZE = 128;
const MIN_TITLE_SIZE = 56;

/** Shrinks the display title as it grows so two lines always fit the card. */
export function ogTitleFontSize(titleLength: number): number {
  if (titleLength <= 14) return MAX_TITLE_SIZE;
  const size = Math.round(MAX_TITLE_SIZE - (titleLength - 14) * 2.2);
  return Math.max(MIN_TITLE_SIZE, size);
}

type Font = { name: string; data: Buffer; weight: 700 | 900; style: "normal" };
let fonts: Font[] | null = null;

function loadFonts(): Font[] {
  if (fonts) return fonts;
  const require = createRequire(import.meta.url);
  const file = (path: string) => readFileSync(require.resolve(path));
  fonts = [
    { name: "Big Shoulders Display", data: file("@fontsource/big-shoulders-display/files/big-shoulders-display-latin-900-normal.woff"), weight: 900, style: "normal" },
    { name: "Hanken Grotesk", data: file("@fontsource/hanken-grotesk/files/hanken-grotesk-latin-700-normal.woff"), weight: 700, style: "normal" },
  ];
  return fonts;
}

type Style = Record<string, string | number>;
type El = { type: string; props: { style?: Style; children?: El | string | (El | string | null)[] } };
const div = (style: Style, children?: El["props"]["children"]): El => ({ type: "div", props: { style: { display: "flex", ...style }, children } });

const DISPLAY = "Big Shoulders Display";
const BODY = "Hanken Grotesk";

function frame(children: (El | null)[]): El {
  return div(
    {
      width: WIDTH,
      height: HEIGHT,
      boxSizing: "border-box",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: "56px 64px",
      backgroundColor: C.surface,
      // The stage light: a cobalt glow from above, falling on the title.
      backgroundImage: `radial-gradient(circle at 78% -10%, ${C.cobalt}cc 0%, ${C.cobalt}33 38%, ${C.surface}00 62%)`,
      color: C.ink,
      fontFamily: BODY,
    },
    children,
  );
}

function topRow(tag: string | null): El {
  return div({ justifyContent: "space-between", alignItems: "center" }, [
    tag
      ? div(
          { backgroundColor: C.signal, color: "#ffffff", fontFamily: DISPLAY, fontSize: 30, padding: "8px 14px", letterSpacing: 2.4 },
          tag.toLocaleUpperCase("es-AR"),
        )
      : div({}),
    div({ fontFamily: DISPLAY, fontSize: 34, color: C["ink-muted"], letterSpacing: 3 }, "GOROSEI"),
  ]);
}

// The self-hosted fonts carry Latin only; emoji and other pictographs would render as empty boxes.
const PICTOGRAPHS = /[\p{Extended_Pictographic}\u200d\ufe0f]/gu;
const printable = (s: string) => s.replace(PICTOGRAPHS, "").replace(/\s+/g, " ").trim();

function titleBlock(title: string, edition: number | null): El {
  const text = printable(title).toLocaleUpperCase("es-AR");
  const size = ogTitleFontSize(text.length);
  return div({ flexDirection: "column", gap: 8 }, [
    edition === null ? null : div({ fontFamily: DISPLAY, fontSize: 32, color: C["ink-muted"], letterSpacing: 1.5 }, t("cup.edition", { edition })),
    div(
      // Room above the first line keeps the accents on capitals (Ñ, Ó) from being clipped; two lines at most.
      { fontFamily: DISPLAY, fontSize: size, lineHeight: 1, paddingTop: Math.round(size * 0.14), maxHeight: Math.round(size * 2.14), overflow: "hidden", maxWidth: WIDTH - 128, wordBreak: "break-word" },
      text,
    ),
  ]);
}

function prizeBlock(label: string, amountArs: number): El {
  return div({ flexDirection: "column" }, [
    div({ fontSize: 26, color: C["ink-muted"] }, label),
    div({ fontFamily: DISPLAY, fontSize: 104, lineHeight: 1, color: C["cobalt-light"] }, formatArs(amountArs)),
  ]);
}

function captionBar(block: string, bar: string | null): El {
  return div({ fontFamily: DISPLAY, fontSize: 34, lineHeight: 1 }, [
    div({ backgroundColor: C.cobalt, color: C.ink, padding: "12px 16px", letterSpacing: 1.4 }, block.toLocaleUpperCase("es-AR")),
    bar ? div({ backgroundColor: C.ink, color: C.surface, padding: "12px 16px", letterSpacing: 0.7 }, bar.toLocaleUpperCase("es-AR")) : null,
  ]);
}

function tournamentCard(input: OgInput): El {
  if (input.kind === "upcoming") {
    return frame([
      topRow(t(`tournament.status.${input.status}`)),
      titleBlock(input.title, input.edition),
      div({ justifyContent: "space-between", alignItems: "flex-end" }, [
        captionBar(formatCupDay(input.startsAt), `${formatCupTime(input.startsAt)} ${t("cup.timeZone")}`),
        input.status === "cancelled" || input.championPrizeArs <= 0 ? null : prizeBlock(t("og.prizeLabel"), input.championPrizeArs),
      ]),
    ]);
  }
  return frame([
    topRow(t("tournament.status.finished")),
    titleBlock(input.title, input.edition),
    div({ justifyContent: "space-between", alignItems: "flex-end" }, [
      input.champion ? captionBar(t("og.champion"), printable(input.champion)) : div({}),
      input.champion && input.championPrizeArs > 0 ? prizeBlock(t("og.prizeWon"), input.championPrizeArs) : null,
    ]),
  ]);
}

function defaultCard(): El {
  return frame([
    topRow(null),
    div({ flexDirection: "column", gap: 16 }, [
      div({ fontFamily: DISPLAY, fontSize: 128, lineHeight: 0.85 }, t("og.default.title").toLocaleUpperCase("es-AR")),
      div({ fontFamily: DISPLAY, fontSize: 128, lineHeight: 0.85, color: C["cobalt-light"] }, t("og.default.titleLine2").toLocaleUpperCase("es-AR")),
    ]),
    captionBar("LAS", t("og.default.caption")),
  ]);
}

async function render(element: El): Promise<Uint8Array> {
  const svg = await satori(element as unknown as ReactNode, { width: WIDTH, height: HEIGHT, fonts: loadFonts() });
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } }).render().asPng());
}

const CACHE_SIZE = 50;
const cache = new Map<string, Uint8Array>();

async function cached(key: string, build: () => Promise<Uint8Array>): Promise<Uint8Array> {
  const hit = cache.get(key);
  if (hit) return hit;
  const png = await build();
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, png);
  return png;
}

export function renderTournamentOg(input: OgInput): Promise<Uint8Array> {
  return cached(JSON.stringify(input), () => render(tournamentCard(input)));
}

export function renderDefaultOg(): Promise<Uint8Array> {
  return cached("default", () => render(defaultCard()));
}

const pngResponse = (png: Uint8Array) =>
  new Response(png.slice(), { headers: { "content-type": "image/png", "cache-control": "public, max-age=300" } });

/** GET /og/torneos/<slug>.png: drafts and unknown slugs are 404. */
export async function tournamentOgResponse(db: Db, file: string): Promise<Response> {
  const slug = file.endsWith(".png") ? file.slice(0, -4) : null;
  const view = slug ? await getTournamentView(db, slug) : null;
  if (!view) return new Response("Not found", { status: 404 });
  const input: OgInput =
    view.status === "finished"
      ? await finishedInput(db, view)
      : {
          kind: "upcoming",
          title: view.title,
          edition: view.edition,
          startsAt: view.startsAt,
          status: view.status,
          championPrizeArs: view.goalShares[0] ?? 0,
        };
  return pngResponse(await renderTournamentOg(input));
}

async function finishedInput(db: Db, view: NonNullable<Awaited<ReturnType<typeof getTournamentView>>>): Promise<OgInput> {
  const { getTournamentResults } = await import("../tournaments/results");
  const results = await getTournamentResults(db, view.id, view.prizeShares);
  return {
    kind: "finished",
    title: view.title,
    edition: view.edition,
    champion: results?.champion?.teamName ?? null,
    championPrizeArs: view.prizeShares[0] ?? 0,
  };
}

export async function defaultOgResponse(): Promise<Response> {
  return pngResponse(await renderDefaultOg());
}
