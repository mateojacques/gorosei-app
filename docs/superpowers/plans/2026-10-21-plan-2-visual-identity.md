# Plan 2: Visual Identity & Cup Landing Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Gorosei its "En vivo" broadcast identity, ship a cup landing page at `/` and a privacy page at `/privacidad`, and restyle every Plan 1 page in the new look.

**Architecture:** Design tokens live in `src/styles.css` (Tailwind v4 `@theme`, OKLCH). Pure, testable logic (cup config, countdown, formatting, CTA choice) lives in `src/shared/`. Presentational components live in `src/components/` (`site/` shell, `cup/` landing pieces, `ui/` shadcn primitives). The root route loads the viewer's sign-in/Riot state once via a server function; the header and the landing CTA read it.

**Tech Stack:** Existing Plan 1 stack (Bun, TanStack Start, React 19, Tailwind v4, Better Auth, Drizzle) + shadcn/ui, `@fontsource` packages for Big Shoulders Display and Hanken Grotesk, `culori` (dev, contrast tests), Playwright (Chromium browser for layout/motion checks).

**Spec:** `docs/superpowers/specs/2026-10-21-visual-identity-design.md` (parent: `docs/superpowers/specs/2026-10-21-gorosei-mvp-design.md`)

## Global Constraints

- Every user-facing string goes through `t()` from `src/shared/i18n` (es-AR, "vos" forms); times display in `America/Argentina/Buenos_Aires`.
- Dark only. Token values (starting point; tune L/C for contrast, keep hue and role): surface `oklch(0.14 0.012 230)`, ink `oklch(0.96 0.005 230)`, cobalt `oklch(0.55 0.13 230)`, cobalt-light `oklch(0.78 0.12 230)`, signal red `oklch(0.62 0.22 27)`.
- Display type Big Shoulders Display (800–900, uppercase for titles/numbers); body Hanken Grotesk (400/600/700). Self-hosted via `@fontsource`, Latin subset, `font-display: swap`.
- Signal red only for the live/status tag and the primary call to action.
- WCAG 2.1 AA: body text ≥ 4.5:1, large text ≥ 3:1, visible focus states; every animation has a `prefers-reduced-motion` alternative; content visible by default (never gated on an animation).
- Public pages are server-rendered and fully readable with JavaScript disabled.
- No hero photo/video; the stage light is CSS. No Riot/Worlds/LoL Esports logos, Summoner's Cup imagery or champion art.
- Riot notice on every page, verbatim: `Gorosei isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.`
- `impeccable` bans apply: no card grids, gradient text, glassmorphism, side-stripe borders, tiny uppercase eyebrow above every section, purple gradients, `border-radius` > 16px on surfaces.
- Privacy contact address: `mateojacquesweb@gmail.com`.

## Review Focus

1. **Narrow phones (320–360px) and long config values** (e.g. prize 1.000.000, long rank-cap text) — no horizontal scroll, no clipped prize. → overflow spec in Task 2, run on every page added later.
2. **Cup start time already passed** — countdown never shows negative numbers; shows the "en juego" state instead. → Task 3 unit test, Task 4 component behavior.
3. **Server running in UTC** — cup date/time still renders in ART (e.g. 21:00Z → "18:00"). → Task 3 unit test.
4. **Reduced-motion users** — hero renders with no running animations. → Task 4 e2e.
5. **Signed-in visitors** — the landing CTA matches their state (link Riot / ready), never "creá tu cuenta" for someone already signed in. → Task 3 unit test, Task 4 e2e with a session.

---

## File Structure

```
PRODUCT.md, DESIGN.md                 project design context (impeccable format)
components.json                       shadcn config
src/styles.css                        tokens (@theme), font imports, base styles, motion keyframes
src/lib/utils.ts                      shadcn cn()
src/components/ui/{button,input,label}.tsx   shadcn primitives, restyled
src/components/site/site-header.tsx, site-footer.tsx
src/components/cup/stage.tsx, caption-bar.tsx, countdown.tsx, prize.tsx, cup-facts.tsx, cup-cta.tsx
src/shared/featured-cup.ts            cup config (placeholders)
src/shared/countdown.ts               countdown math
src/shared/format.ts                  ARS money, cup date/time
src/shared/landing-cta.ts             CTA choice from viewer state
src/server/viewer.functions.ts        getViewerState server fn
src/routes/__root.tsx (modify), index.tsx (rewrite), privacidad.tsx (new),
  ingresar.tsx, vincular-riot.tsx, jugador.$riotId.tsx (restyle)
tests/shared/{theme,format,countdown,featured-cup,landing-cta}.test.ts
e2e/{layout,shell,landing,privacy}.spec.ts  (profile.spec.ts kept)
```

---

### Task 1: Tokens, fonts, design context, shadcn base

**Files:**
- Modify: `src/styles.css`, `package.json`, `tsconfig.json`, `vite.config.ts` (alias only if shadcn needs it)
- Create: `PRODUCT.md`, `DESIGN.md`, `components.json`, `src/lib/utils.ts`, `src/components/ui/{button,input,label}.tsx`
- Test: `tests/shared/theme.test.ts`

**Interfaces:**
- Produces: CSS custom properties / Tailwind colors `--color-surface`, `--color-ink`, `--color-ink-muted`, `--color-cobalt`, `--color-cobalt-light`, `--color-signal`, `--color-line`; font utilities `font-display` (Big Shoulders Display) and `font-body` (Hanken Grotesk, default on `body`); `cn(...classes)` in `src/lib/utils.ts`; `Button`, `Input`, `Label` from `src/components/ui/*` (shadcn API; `Button` variants `primary` = signal red, `secondary` = cobalt outline, `ghost`).

- [ ] **Step 1: Write the failing test** `tests/shared/theme.test.ts`: read `src/styles.css`, extract each `--color-*` OKLCH value, and assert with `culori`'s `wcagContrast`:
  - `ink` on `surface` ≥ 4.5
  - `ink-muted` on `surface` ≥ 4.5
  - `cobalt-light` on `surface` ≥ 4.5
  - white on `signal` ≥ 3 (CTA text is large/bold)
  - `ink` on `cobalt` ≥ 3 (caption-bar block text is large)
- [ ] **Step 2:** Run `bun test tests/shared/theme.test.ts` → FAIL (tokens missing).
- [ ] **Step 3:** Add `culori` (dev), the two `@fontsource` packages, and shadcn (`bunx shadcn@latest init`, Tailwind v4 mode; set up the `@/` alias it requires); generate `button`, `input`, `label` and restyle them to the tokens (square-ish corners ≤ 6px, visible `focus-visible` ring in cobalt-light). Define the tokens in `@theme` using the Global Constraints values (add `ink-muted` and `line` as tinted neutrals at hue 230), set `body` to surface/ink/Hanken Grotesk. Install Playwright's Chromium (`bunx playwright install chromium`) for later tasks.
- [ ] **Step 4:** Write `PRODUCT.md` (register `brand`, platform `web`, users/purpose/positioning/personality/anti-references from both specs, accessibility AA) and `DESIGN.md` (the "En vivo" direction: tokens, type, signature elements — stage light, caption bar, countdown — motion rules), following the impeccable format.
- [ ] **Step 5:** Run `bun test` and `bunx tsc --noEmit` → PASS / clean.
- [ ] **Step 6: Commit** `feat: add En vivo design tokens, fonts and shadcn base`

### Task 2: Site shell (header, footer, Riot notice) and layout guard

**Files:**
- Create: `src/components/site/site-header.tsx`, `src/components/site/site-footer.tsx`, `src/server/viewer.functions.ts`
- Modify: `src/routes/__root.tsx`, `src/shared/i18n/es-AR.ts`
- Test: `e2e/shell.spec.ts`, `e2e/layout.spec.ts`

**Interfaces:**
- Consumes: `getSessionUser` (Plan 1), `riotAccounts` table, tokens/`Button` from Task 1.
- Produces: `type ViewerState = { signedIn: false } | { signedIn: true; riotAccount: { gameName: string; tagLine: string } | null }`; `getViewerState(): Promise<ViewerState>` server fn (GET) in `src/server/viewer.functions.ts`, loaded by the root route's `loader` and read via `Route.useLoaderData()` / `useLoaderData({ from: "__root__" })`; i18n keys `site.riotNotice` (exact notice text), `site.privacy`, `site.signIn`, `site.myProfile`.

- [ ] **Step 1: Write the failing tests:**
  - `e2e/shell.spec.ts`: for `/`, `/ingresar`, `/vincular-riot`, the seeded profile and an unknown profile — HTML contains the exact Riot notice and a link to `/privacidad`.
  - `e2e/layout.spec.ts` (browser, JS enabled): for every public route above at widths 320, 360, 768, 1280 — `document.documentElement.scrollWidth <= window.innerWidth`. Keep the route list in one array so later tasks append `/privacidad`.
- [ ] **Step 2:** Run `bunx playwright test e2e/shell.spec.ts e2e/layout.spec.ts` → shell FAILS (no notice).
- [ ] **Step 3:** Implement the header (`GOROSEI` wordmark in display type linking to `/`; right side: `site.signIn` → `/ingresar` when signed out, `site.myProfile` → `/jugador/<slug>` when linked, `/vincular-riot` when signed in without Riot) and the footer (privacy link + notice in small `ink-muted` text). Root `<title>`/`lang` stay; wrap `children` with header/footer in `RootDocument`.
- [ ] **Step 4:** Run `bunx playwright test` and `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add site shell with Riot notice`

### Task 3: Cup config, formatting, countdown and CTA logic (pure)

**Files:**
- Create: `src/shared/featured-cup.ts`, `src/shared/format.ts`, `src/shared/countdown.ts`, `src/shared/landing-cta.ts`
- Modify: `src/shared/i18n/es-AR.ts`
- Test: `tests/shared/{featured-cup,format,countdown,landing-cta}.test.ts`

**Interfaces:**
- Consumes: `t`, `MessageKey`, `TIME_ZONE` (Plan 1), `ViewerState` (Task 2), `riotIdToSlug` (Plan 1).
- Produces:
  ```ts
  type FeaturedCup = {
    edition: number;                 // 1
    startsAt: Date;                  // UTC
    prizeArs: number;                // 300000 (placeholder)
    entryFeeArs: number;             // 5000 per player (placeholder)
    rankCap: Tier;                   // "DIAMOND" (placeholder) — "hasta Diamante"
    teamCap: number;                 // 16
    bracket: "double_elimination" | "single_elimination";
    streamUrl: string;               // Twitch channel URL (placeholder)
    status: "upcoming" | "registration_open";   // default "upcoming"
  };
  export const featuredCup: FeaturedCup;
  formatArs(amount: number): string;            // 300000 → "$300.000"
  formatCupDay(d: Date): string;                // "SÁB 7/11" (ART)
  formatCupTime(d: Date): string;               // "18:00" (ART)
  type Countdown = { days: number; hours: number; minutes: number; seconds: number };
  getCountdown(now: Date, startsAt: Date): Countdown | null;   // null once startsAt <= now
  formatCountdown(c: Countdown): string;        // "16d 04h 12m"
  type LandingCta = { labelKey: MessageKey; href: string };
  getLandingCta(viewer: ViewerState): LandingCta;
  ```
  i18n keys: `cup.title.line1` ("Copa"), `cup.title.line2` ("Semanal"), `cup.edition` ("LAS · Edición #{edition}"), `cup.status.upcoming` ("Próximamente"), `cup.status.registration_open` ("Inscripción abierta"), `cup.untilStart` ("para el inicio"), `cup.live` ("En juego"), `cup.prizeCaption` ("Premio para el equipo campeón"), `cup.who`/`cup.what`/`cup.where`/`cup.entry` labels + value templates, `cup.poolNote` ("el pozo es el premio"), `cup.cta.signUp` ("Preparate: creá tu cuenta"), `cup.cta.linkRiot` ("Vinculá tu cuenta de Riot"), `cup.cta.ready` ("Ya estás listo: la inscripción abre pronto").

- [ ] **Step 1: Write the failing tests:**
  - `formatArs(300000) === "$300.000"`, `formatArs(1000000) === "$1.000.000"`.
  - `formatCupDay(new Date("2026-11-07T21:00:00Z")) === "SÁB 7/11"` and `formatCupTime(same) === "18:00"`; a date at `02:00Z` on the 8th formats as Saturday 7/11 23:00 (ART day boundary).
  - `getCountdown(now, now + 16d 4h 12m 39s)` → `{days:16,hours:4,minutes:12,seconds:39}`; `formatCountdown` → `"16d 04h 12m"`; `getCountdown` at and after `startsAt` → `null`.
  - `featuredCup`: `prizeArs > 0`, `entryFeeArs > 0`, `teamCap > 0`, `startsAt` is a valid Date, `status` defaults to `"upcoming"`.
  - `getLandingCta({signedIn:false})` → `{labelKey:"cup.cta.signUp", href:"/ingresar"}`; signed in, no Riot → `{"cup.cta.linkRiot", "/vincular-riot"}`; linked as `Señor Café#LAS` → `{"cup.cta.ready", "/jugador/Se%C3%B1or%20Caf%C3%A9-LAS"}`.
- [ ] **Step 2:** Run `bun test tests/shared` → FAIL (modules missing).
- [ ] **Step 3:** Implement. Dates via `Intl.DateTimeFormat("es-AR", { timeZone: TIME_ZONE })`, uppercasing the weekday abbreviation without its trailing dot; money via `Intl.NumberFormat("es-AR")` with a leading `$` and no decimals. Placeholder values: edition 1, 2026-11-07 18:00 ART, prize 300000, fee 5000, `DIAMOND`, 16 teams, double elimination, `https://www.twitch.tv/` (placeholder), status `"upcoming"`; mark the object with a comment that these are placeholders to edit before launch.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add featured cup config, countdown and CTA logic`

### Task 4: Cup landing page

**Files:**
- Create: `src/components/cup/{stage,caption-bar,countdown,prize,cup-facts,cup-cta}.tsx`
- Modify: `src/routes/index.tsx` (rewrite), `src/styles.css` (stage light + entrance keyframes)
- Test: `e2e/landing.spec.ts`

**Interfaces:**
- Consumes: everything from Task 3; root `ViewerState` (Task 2); `Button` (Task 1); `formatRank`-style tier label via `t("rank.tier.<TIER>")`.

- [ ] **Step 1: Write the failing tests** `e2e/landing.spec.ts`:
  - JS disabled: HTML contains `COPA`, `SEMANAL`, `LAS · Edición #1` (case-insensitive), `SÁB 7/11`, `18:00`, `$300.000`, `Premio para el equipo campeón`, the four fact labels (`Quiénes`, `Qué`, `Dónde`, `Entrada`), `Diamante`, `el pozo es el premio`, and an `<a href="/ingresar">` with `Preparate: creá tu cuenta`; `<title>` contains `Copa Semanal`; a `meta[name=description]` mentions the prize and date.
  - JS enabled: the countdown text matches `/\d+d \d{2}h \d{2}m/`, and its `data-remaining` attribute (whole seconds until start) is lower 1.5s later than on first read.
  - Signed in without Riot (sign up via `/api/auth/sign-up/email` in the test, reuse the cookie): CTA links to `/vincular-riot` with `Vinculá tu cuenta de Riot`.
  - `reducedMotion: "reduce"`: `document.getAnimations().length === 0` after load.
- [ ] **Step 2:** Run `bunx playwright test e2e/landing.spec.ts` → FAIL.
- [ ] **Step 3:** Build the page in the approved order (spec §6.2): header (shell) → stage with status tag, edition, two-line title (line 2 in cobalt-light), caption bar (cobalt block: day + time; light bar: countdown + `cup.untilStart`, or `cup.live` once started) → prize block (largest element, cobalt-light display type, `formatArs`) with caption → facts list (`<dl>`) → CTA `Button` variant `primary` from `getLandingCta`. `Countdown` renders `formatCupDay/Time` on the server and starts ticking only after mount (`useEffect`), exposing `data-remaining`. Desktop (≥ 768px): wider stage, prize beside the facts list. Motion: one page-load sequence (title lines rise in, stage beam sweeps once, prize settles) with exponential ease-out; under `prefers-reduced-motion: reduce` no keyframe animations run. Page `head`: title `t("cup.metaTitle")`, description `t("cup.metaDescription", {prize, day, time})`.
- [ ] **Step 4:** Run `bunx playwright test` and `bun test` → PASS. Screenshot `/` at 360, 768 and 1280 and check it against the approved mockup (prize the largest element, date in the caption bar).
- [ ] **Step 5: Commit** `feat: add Copa Semanal landing page`

### Task 5: Privacy page

**Files:**
- Create: `src/routes/privacidad.tsx`
- Modify: `src/shared/i18n/es-AR.ts`, `e2e/layout.spec.ts` (add `/privacidad`)
- Test: `e2e/privacy.spec.ts`

- [ ] **Step 1: Write the failing test** `e2e/privacy.spec.ts`: `GET /privacidad` → 200; HTML contains `mateojacquesweb@gmail.com` (as a `mailto:` link), `Riot ID`, `PUUID`, a heading `Política de privacidad`, and the Riot notice; `<title>` contains `Privacidad`.
- [ ] **Step 2:** Run → FAIL (404).
- [ ] **Step 3:** Write the page as readable long-form (max ~70ch, body type, display type for headings only). Sections, es-AR, plain language: what we collect (name, email, Discord ID if used, Riot ID, PUUID, level, profile icon, rank history, session cookie); why (accounts, Riot ownership verification, tournament eligibility, public profiles); what is public (profile: Riot ID, level, current rank, season peak, teams, tournament history); third parties (Riot Games API, Discord sign-in, hosting); retention and deletion on request; contact. Last-updated date via `formatDateTime`. All copy through `t()` (one key per paragraph is fine).
- [ ] **Step 4:** Run `bunx playwright test` → PASS.
- [ ] **Step 5: Commit** `feat: add privacy policy page`

### Task 6: Restyle sign-in and Riot linking

**Files:**
- Modify: `src/routes/ingresar.tsx`, `src/routes/vincular-riot.tsx`
- Test: `e2e/forms.spec.ts`

**Interfaces:**
- Consumes: `Button`, `Input`, `Label` (Task 1); `CaptionBar` from `src/components/cup/caption-bar.tsx` (Task 4); behavior and server functions unchanged from Plan 1.

- [ ] **Step 1: Write the failing test** `e2e/forms.spec.ts` (JS enabled): on `/ingresar`, the email and password inputs are reachable by their labels (`getByLabel("Email")`, `getByLabel("Contraseña")`), the submit button is focusable and shows a visible focus outline (`outline-style` or `box-shadow` not `none` on `:focus-visible` after Tab); toggling to sign-up shows `getByLabel("Nombre")`. On `/vincular-riot` with a session: `getByLabel("Riot ID")` exists and submitting `nohash` shows the `riotLink.error.invalid_riot_id` text in an element with `role="alert"`.
- [ ] **Step 2:** Run → FAIL on the focus-visible check (plain inputs have no styled focus).
- [ ] **Step 3:** Rebuild both pages with the shadcn primitives in the En vivo look: display-type page titles, the required-icon number shown big in display type with the countdown in a caption bar (reusing `caption-bar.tsx`), errors in an `role="alert"` region. No behavior changes.
- [ ] **Step 4:** Run `bunx playwright test` and `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: restyle sign-in and Riot linking pages`

### Task 7: Restyle player profile and not-found

**Files:**
- Modify: `src/routes/jugador.$riotId.tsx`
- Test: `e2e/profile.spec.ts` (extend)

- [ ] **Step 1: Extend the test:** the profile page's Riot ID is in an `<h1>`; current rank and season peak appear as `<dd>` values next to `Rango actual` / `Pico de temporada`; the unknown-profile 404 page contains a link back to `/`.
- [ ] **Step 2:** Run `bunx playwright test e2e/profile.spec.ts` → FAIL (no link back home).
- [ ] **Step 3:** Restyle: Riot ID as the display-type hero on the stage background, level in the caption bar, ranks in display type (cobalt-light), empty "Equipos" / "Historial de torneos" states as quiet single lines. Not-found: friendly message plus a link to the cup landing page.
- [ ] **Step 4:** Run `bun test` and `bunx playwright test` → PASS. Screenshot each restyled page at 360 and 1280.
- [ ] **Step 5: Commit** `feat: restyle player profile in En vivo look`

---

## Done when

`bun test` and `bunx playwright test` pass; `/`, `/privacidad`, `/ingresar`, `/vincular-riot` and `/jugador/<slug>` render in the En vivo identity with the Riot notice and no horizontal scroll from 320px up; `PRODUCT.md` and `DESIGN.md` describe the system; the cup placeholders are one edit away in `src/shared/featured-cup.ts`.
