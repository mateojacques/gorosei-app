---
name: Gorosei
description: Weekly League of Legends cups for LAS, dressed as a live broadcast at night.
colors:
  surface: "oklch(0.14 0.012 230)"
  surface-raised: "oklch(0.18 0.016 230)"
  line: "oklch(0.3 0.02 230)"
  ink: "oklch(0.96 0.005 230)"
  ink-muted: "oklch(0.72 0.015 230)"
  cobalt: "oklch(0.5 0.13 230)"
  cobalt-light: "oklch(0.78 0.12 230)"
  signal: "oklch(0.58 0.22 27)"
  signal-hover: "oklch(0.52 0.21 27)"
typography:
  display:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "clamp(4rem, 22vw, 6rem)"
    fontWeight: 900
    lineHeight: 0.85
    letterSpacing: "-0.01em"
  prize:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "clamp(3.5rem, 19vw, 6rem)"
    fontWeight: 900
    lineHeight: 0.9
  label:
    fontFamily: "Big Shoulders Display, Arial Narrow, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 800
    letterSpacing: "0.04em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "4px"
  md: "6px"
spacing:
  gutter: "16px"
  section: "clamp(3rem, 8vw, 6rem)"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "12px 28px"
  button-primary-hover:
    backgroundColor: "{colors.signal-hover}"
  button-secondary:
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "44px"
  caption-block:
    backgroundColor: "{colors.cobalt}"
    textColor: "{colors.ink}"
  caption-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
---

# Design System: Gorosei

## 1. Overview: En vivo

The broadcast at night. A player in Buenos Aires taps a story ad between ranked games and the page should feel like the moment a broadcast goes live: a dark stage, a cobalt light falling on the title, a lower-third caption bar with the date, a clock running down. It borrows the grammar of an esports broadcast without borrowing anyone's marks: no Riot, Worlds or LoL Esports logos, no trophy imagery, no champion art. There is no hero photo or video; the stage light is CSS. Dark only.

Layout is a single column on phones (16px gutter, the primary target) that widens into a stage on desktop, where the prize sits beside the facts list. Pacing is a few big, single-idea blocks rather than many small sections.

## 2. Colors: Stage light and signal

Strategy: committed. Near-black tinted cobalt carries the surface; cobalt is the light on the stage; red is on-air only.

### Primary
- **Cobalt** `oklch(0.5 0.13 230)`: the stage light and the caption-bar block. Ink on cobalt is 5.2:1.
- **Cobalt light** `oklch(0.78 0.12 230)`: display accents only: the prize amount, the second title line, rank values, focus rings. 10:1 on surface.

### Secondary
- **Signal red** `oklch(0.58 0.22 27)`: the live/status tag and the primary call to action. White on signal is 4.8:1.

### Neutral
- **Surface** `oklch(0.14 0.012 230)`, **surface raised** `oklch(0.18 0.016 230)` for inputs, **line** `oklch(0.3 0.02 230)` for hairlines.
- **Ink** `oklch(0.96 0.005 230)` for text, **ink muted** `oklch(0.72 0.015 230)` for secondary text (8:1).

### Named Rules
- **Red means live.** Signal red appears at most twice per screen: the status tag and the one CTA. Never for errors, links or borders.
- **Light falls on one thing.** Cobalt light is for the single most important number or word in a block, not for every label.
- Token values are tested for contrast in `tests/shared/theme.test.ts`; tune lightness and chroma, keep hue and role.

## 3. Typography

Display: **Big Shoulders Display** 800–900, condensed, uppercase for titles, numbers and labels; it is the scoreboard. Body: **Hanken Grotesk** 400/600/700, a warm grotesque that stays readable at small sizes. Both self-hosted via `@fontsource`, Latin subset, `font-display: swap`. Utilities: `font-display`, `font-body` (default on `body`).

### Hierarchy
- **Title** (COPA / SEMANAL): display 900, `clamp(4rem, 22vw, 6rem)`, line-height 0.85, two lines, second line cobalt light.
- **Prize**: display 900, the largest element on the landing page, cobalt light.
- **Page title** (other pages): display 900, `clamp(2.5rem, 10vw, 4rem)`.
- **Labels** (Quiénes, Qué…): display 800, ~1.125rem, uppercase, slight positive tracking, ink muted.
- **Body**: Hanken 400, 1rem, line-height 1.6, max ~70ch for long-form.

### Named Rules
- Display letter-spacing never tighter than -0.02em.
- No all-caps body copy; caps are for display type only.

## 4. Elevation

Flat. No drop shadows on surfaces. Depth comes from light, not shadow: the stage is a radial cobalt glow plus one angled beam behind the title (pure CSS gradients, no images). Hairline `line` borders separate rows where needed.

### Named Rules
- **No ghost cards.** Never a 1px border plus a soft wide shadow. No glassmorphism, no gradient text.

## 5. Components

### Buttons
`Button` (`src/components/ui/button.tsx`, shadcn base). Variants: `primary` (signal red, white bold text), `secondary` (2px cobalt-light outline), `ghost` (text). Corners 4px. Focus: 2px cobalt-light outline, 3px offset.

### Inputs / Fields
`Input` + `Label`: surface-raised fill, `line` border, 44px tall, 4px corners; focus switches the border and adds the cobalt-light outline. Invalid fields set `aria-invalid` but stay off red (red means live). Labels sit above fields in Hanken 600. Errors render in a `role="alert"` region.

### Navigation
Site header: `GOROSEI` wordmark in display type left; one account link right (Ingresar / Mi perfil / link Riot). Footer: privacy link plus the verbatim Riot notice in small ink-muted text, on every page.

### Caption bar (signature)
A TV lower-third: a cobalt block with the compact fact (day + time, or the required icon number) followed by a light bar (ink fill, surface text) with the running value (countdown). Display type, uppercase. Square corners.

### Stage (signature)
The hero backdrop: cobalt radial glow and angled beam behind the title; status tag (signal red, uppercase display, square) at the top; edition line; two-line title; caption bar at the bottom.

### Countdown (signature)
Server renders the date; the ticking `16d 04h 12m` mounts on the client. Once the start time passes it shows "En juego" instead of negative numbers.

## 6. Do's and Don'ts

### Do:
- Keep the five Ws (who, what, when, where, prize) readable on a 320px phone with no horizontal scroll.
- Put the fee and "el pozo es el premio" side by side.
- Orchestrate one page-load sequence (title lines rise, the beam sweeps once, the prize settles) with exponential ease-out, and replace it with nothing under `prefers-reduced-motion: reduce`.
- Render all content server-side; motion and the ticking countdown only enhance.
- Route every string through `t()`; show times in ART.

### Don't:
- Card grids, purple gradients, gradient text, glassmorphism, side-stripe borders, an uppercase eyebrow above every section, corners above 16px.
- Riot/Worlds/LoL Esports logos, trophy imagery, champion art, anything that implies Riot made or endorses Gorosei.
- Signal red for anything but the status tag and the primary CTA.
- Gate any content on an animation or on JavaScript.
