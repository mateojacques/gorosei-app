# Gorosei — Visual Identity & Cup Landing Page (Plan 2 design)

*Date: 2026-10-21. Parent spec: `docs/superpowers/specs/2026-10-21-gorosei-mvp-design.md` (§2 anti-goals, §6 visual design requirement). Roadmap: Plan 2 in `docs/superpowers/plans/2026-10-21-gorosei-roadmap.md`, extended here with a cup landing page and a privacy page.*

## 1. Intent

Gorosei needs a visual identity before Plans 3–6 add dozens of screens, and it needs a public page now: the Riot production-key application requires a live Product URL, and the first players will arrive from Instagram ads.

The feeling, in the owner's words: **before even tapping, players feel the competitive rush and are drawn to the glory of winning the tournament and the prize. On the page, they understand the tournament at a glance — it answers the five Ws** (who can play, what it is, when, where, why it's worth it).

Reference the owner named: **the Worlds broadcast and Riot esports style.** The identity should *feel* like a live esports broadcast while being clearly Gorosei's own (Riot's brand rules forbid anything implying Riot made or endorses the product).

The name "Gorosei" is the owner's team name and carries no brand concept; the identity comes from the broadcast feel, not the name.

## 2. Goals

1. A **visual identity system** — color tokens, typography, spacing, motion rules, and a small set of core components — that every later plan builds on.
2. A **cup landing page at `/`** announcing the first weekly cup (Copa Semanal LAS #1) with its date and prize, mobile-first, built for Instagram-ad traffic.
3. A **privacy policy page at `/privacidad`**, for the Riot application and for players.
4. **Restyle the existing Plan 1 pages** (`/ingresar`, `/vincular-riot`, `/jugador/$riotId`, the profile not-found state) in the new identity, so the whole site feels like one place.
5. A **site shell** — header and footer on every page, the footer carrying the Riot legal notice and a link to the privacy page.
6. Project design context written down: **`PRODUCT.md`** and **`DESIGN.md`** at the repo root (the `impeccable` skill's format), so later plans stay on-brand.

## 3. Non-goals

- Tournament data model, registration, teams, payments, brackets — Plan 3 onward. The landing page's cup is **configuration**, not a database record.
- Browse page, stage-aware tournament page, Twitch embed, Open Graph share images, sitemap, schema.org `Event` — Plan 6.
- A light theme or theme toggle. Dark only (see §6.1).
- Admin UI for editing the cup.
- Deployment and hosting of the public URL (needed for the Riot application, but a separate step; see §9).

## 4. Anti-goals (a failure even if it works)

- The generic AI look: card grids, purple gradients, gradient text, glassmorphism, a tiny uppercase label above every section (parent spec §2, `impeccable` bans).
- Looking like an official Riot product: no Riot, Worlds or LoL Esports logos, no Summoner's Cup imagery, no Riot marks.
- A page that's exciting but unclear: if a visitor can't answer *who / what / when / where / prize* within a few seconds on a phone, it failed.
- Players surprised by prize amounts: the "prize is the real pool of entry fees" line must sit next to the fee (parent spec §2).

## 5. Constraints

- All user-facing strings go through `t()` (es-AR); times shown in `America/Argentina/Buenos_Aires`.
- Public pages are server-rendered; the landing page must render its full content with JavaScript disabled (the countdown may then show the date only).
- Fast first load on mobile over Argentine networks: no hero photo or video; the stage light is CSS. Fonts self-hosted and subset (Latin), `font-display: swap`.
- WCAG 2.1 AA: text contrast ≥ 4.5:1 (≥ 3:1 for large text), visible focus states, every animation has a `prefers-reduced-motion` alternative.
- Riot legal notice on every page, verbatim (English, as Riot provides it): *"Gorosei isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc."*
- Stack as decided in the parent spec: Tailwind v4, shadcn/ui as the base for components, heavily customized.

## 6. Decided with the owner

### 6.1 Direction: "En vivo" (the broadcast at night)

Chosen from three mockups (broadcast at night / prize-drenched poster / football matchday sheet). Scene: a player in Buenos Aires, at night, on their phone, taps a story ad between ranked games; the page should feel like the moment a broadcast goes live.

- **Surface:** near-black tinted toward cobalt — `oklch(0.14 0.012 230)`.
- **Primary — cobalt stage light:** `oklch(0.55 0.13 230)`; a lighter cobalt `oklch(0.78 0.12 230)` for display accents (the prize amount, the second line of the title, labels).
- **Signal red — "on air":** `oklch(0.62 0.22 27)`, reserved for the live/status tag and the primary call to action.
- **Ink:** `oklch(0.96 0.005 230)`.
- **Display type:** Big Shoulders Display (condensed, 800–900, uppercase for titles and numbers).
- **Body type:** Hanken Grotesk (400/600/700).
- **Signature elements:** a CSS "stage light" (soft cobalt glow and an angled light beam) behind the hero title; a **broadcast caption bar** (a cobalt block + a light bar, like a TV lower-third) for compact key facts; a ticking countdown.

These values are the starting point; the builder may tune lightness/chroma for contrast, keeping hue and role.

### 6.2 Landing page layout (mobile, top to bottom)

Approved from the revised mockup ("A, revised: prize up, date down"):

1. Header: `GOROSEI` wordmark left; red status tag right (e.g. "INSCRIPCIÓN ABIERTA").
2. Stage: "LAS · EDICIÓN #1", then the title **COPA / SEMANAL** (second line in light cobalt), very large.
3. Caption bar at the bottom of the stage: **date and time (small)** in the cobalt block — "SÁB 7/11 · 18:00 ART" — and the **countdown** in the light bar ("16d 04h 12m para el inicio").
4. **The prize as the largest element on the page:** "$300.000" in light cobalt display type, with "Premio para el equipo campeón" under it.
5. The five Ws as a plain label/value list: *Quiénes* (5-player teams from LAS, rank cap), *Qué* (5v5 Summoner's Rift, bracket format, team cap), *Dónde* (online, streamed on Twitch), *Entrada* (fee per player · "el pozo es el premio").
6. One red call to action.

All numbers in the mockup are placeholders (see §8).

### 6.3 Call to action before registration exists

Registration for a cup arrives in Plan 3. Until then the landing CTA gets people ready: **create an account → link Riot account**, so they can register the day it opens.

## 7. Builder's calls (made by me, not confirmed by the owner)

- **Cup content is a typed config file** (e.g. `src/shared/featured-cup.ts`): edition, start time (UTC), prize (ARS), entry fee per player, rank cap, team cap, format, bracket type, stream channel URL, status label. Plan 3 replaces it with real tournament data.
- **CTA changes with the visitor's state:** signed out → "Preparate: creá tu cuenta" (to `/ingresar`); signed in without Riot → "Vinculá tu cuenta de Riot"; fully linked → a confirmation that they're ready ("Ya estás listo — la inscripción abre pronto") plus a link to their profile.
- **Status tag text comes from the config.** If registration isn't actually open in-platform yet, it should not claim "INSCRIPCIÓN ABIERTA"; default to something true (e.g. "PRÓXIMAMENTE").
- **Countdown:** server renders the date; the ticking countdown mounts on the client (no hydration mismatch); after start time it switches to a "live"/"en juego" state.
- **Desktop:** same content, wider stage; the prize can sit beside the five-Ws list. Phone is the primary target.
- **Motion:** one orchestrated page load (title lines rise in, stage light sweeps once, prize counts up or settles in), the countdown ticking. Exponential ease-out; reduced-motion users get an instant or crossfade version. Content is visible by default, never gated on an animation.
- **Fonts self-hosted** via `@fontsource` packages, Latin subset.
- **shadcn/ui:** set up with our tokens; generate only the primitives the restyled pages need (button, input, label) and restyle them. No component library visuals leak through.
- **Profile page** keeps its content (Riot ID, level, current rank, season peak, empty teams/history) in the new look; the rank values get display-type treatment.
- **No Riot game art** (champion splash art) in Plan 2. Riot's policy may allow it with the notice, but the approved direction doesn't need it and it avoids looking official.
- **Privacy page** content: what we collect (account name and email, Discord ID if used, Riot ID / PUUID, level, icon, rank history, session cookie), why (accounts, Riot verification, eligibility, public profiles), what's public (profile data), retention and deletion on request, and the contact address **mateojacquesweb@gmail.com** (owner's choice). Plain language, es-AR.
- **Tests:** server-rendered checks that the landing page shows the five Ws, the prize and the date with JS disabled; that `/privacidad` renders; that the Riot notice appears on every public page; unit tests for countdown formatting and the config shape. Visual check by screenshots at 360, 768 and 1280 px widths.

## 8. Placeholders the owner fills in before launch

The landing page ships with clearly marked placeholder values in the cup config: date/time, prize amount, entry fee, rank cap, team cap, Twitch channel. Changing them is a one-file edit.

## 9. Related, out of scope here

- **Public URL for the Riot application** needs hosting (spec: São Paulo region) and a domain. Plan 2 makes the pages; putting them online is a separate step.
- `docs/riot-api-application.md` should be updated with the final URL once deployed.

## 10. Left to the builder

Exact type scale and spacing, component APIs, the precise motion choreography, desktop composition details, token naming, the wording of secondary copy (within the es-AR voice: direct, competitive, warm — "vos" forms as already used).
