# Plan 6: Tournament Page, Browse & SEO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tournament page stage-aware (landing before, broadcast during, results after), add the browse page, a public live bracket and match detail, team and player history with placements, and the SEO layer (meta tags, Open Graph images, sitemap, schema.org `Event`).

**Architecture:** The stage is a pure function of tournament status; one route (`/torneos/$slug`) renders a different top section per stage and keeps Teams, Bracket, Rules and Schedule below in every stage. The bracket view is read from the stored `brackets.data` joined to the `matches` rows (Plan 5), laid out by a pure function, and rendered server-side as stacked sections (no JavaScript needed to read it); `useRealtime` (Plan 5) keeps it live. Open Graph images are PNGs rendered with `satori` + `@resvg/resvg-js` from the design tokens. All SEO output (meta, JSON-LD, sitemap, robots) comes from pure helpers in `src/shared/seo.ts`, so it is unit-tested without a server.

**Tech Stack:** Existing stack plus `satori` and `@resvg/resvg-js` (OG images). Twitch is embedded with plain iframes; no SDK.

**Spec:** `docs/superpowers/specs/2026-10-21-gorosei-mvp-design.md` §5.2 (browse), §5.8 (stage-aware page), §5.9 (profiles), §6 (SEO/performance), §5.7 (match detail, VOD link). **Roadmap:** `docs/superpowers/plans/2026-10-21-gorosei-roadmap.md`. **Design system:** `DESIGN.md`, `PRODUCT.md`. **Builds on:** Plans 1–5 (completed).

## Global Constraints

- Browse lists **open/upcoming first, then live, then recent finished**; no region filter; filters: date (**today / this week / this weekend**), **format**, **rank bracket**. Drafts and cancelled tournaments are never listed.
- The tournament page is **one URL for the whole life of the tournament**. Before (`registration_open`, `registration_closed`, `check_in`): landing for ads and shared links (hero, countdown, **Register team** and **Find a team** actions, prize meter with the shrink-to-pool warning, schedule, fee and how to pay, personal **"Your status" checklist**; during check-in the check-in action is primary). During (`live`): **embedded Twitch stream + Twitch chat** on top, **live bracket** right below, participants' team panel. After (`finished`): **champion banner** (team, prize won, top 3), final bracket with clickable matches → match detail, VOD list, and a prominent **"Next cup →"** link. Teams, Bracket, Rules and Schedule stay reachable below in every stage.
- Public pages are **server-rendered and readable with JavaScript disabled** (the Twitch iframes, countdown tick and live updates enhance only). No content is gated on an animation.
- SEO: every public page gets a unique `<title>`, description, canonical URL and Open Graph/Twitter tags; tournament pages get a **per-tournament share image** (PNG 1200×630) and **schema.org `Event`** JSON-LD; `/sitemap.xml` and `/robots.txt` exist. Player and team profiles are public and indexable.
- Twitch embeds require a `parent` equal to the page's hostname; the iframe is created on the client after mount from `location.hostname`.
- UI follows `DESIGN.md`: signal red only for the status tag and the one primary action per screen; Impeccable bans apply (no card grids, gradient text, glassmorphism, side-stripe borders, an eyebrow above every section, radius > 16px). The browse page is a schedule (rows), not a grid of cards. Phone first: no horizontal page scroll at 320px (the bracket scrolls inside its own container).
- No Riot, Worlds or LoL Esports marks, trophy imagery or champion art anywhere, including OG images. The Riot notice stays in the footer of every page.
- Every user-facing string goes through `t()` (es-AR, "vos"). Times shown in `America/Argentina/Buenos_Aires` (fixed UTC−03:00, no DST), stored UTC. Domain functions never throw for expected failures; they return a typed reason with an i18n message.

## Review Focus

1. **Tournament pages in unusual states** — `live` with no bracket row yet, `finished` without stored standings, `cancelled` before a bracket existed, a podium where the prize split has fewer entries than places: never a crash, never a champion invented. → Tasks 3, 4, 11.
2. **Junk stream URLs** — empty, not Twitch, `javascript:`, `twitch.tv/videos/123`, uppercase, trailing slash, extra query: no iframe, a plain link only when the URL is a real `https` link, and nothing unescaped reaches an iframe `src`. → Tasks 1, 10.
3. **Public leaks** — a signed-out visitor or an outsider on the public match page and bracket never sees lobby name/password, captain reports, chat or anyone's email; drafts never appear in browse, sitemap, OG images or match pages. → Tasks 3, 4, 6, 7.
4. **Odd bracket shapes** — 2, 3 and 5 teams (byes), single elimination with and without a third-place match, a double-elimination grand final whose reset was never needed, TBD slots, a 24-character team name at 320px. → Tasks 1, 4, 10.
5. **Hostile or odd text in SEO output** — a title containing `</script>`, `&`, `<`, quotes and emoji in JSON-LD, sitemap XML and OG images; an 80-character title; a free tournament (`price: "0"`); a missing prize. → Tasks 2, 6, 7.

## Builder's calls (made here, not confirmed by the owner)

- **One stream channel per tournament** (the data model has a single `streamUrl`). The "featured match" is shown as an **"En juego" list** of matches in play under the stream; a stream selector waits for a model with several channels.
- **No tabs for the bracket:** Winners / Losers / Grand final are stacked sections with an in-page anchor nav, so it works without JavaScript; rounds are columns inside a horizontally scrollable region (`tabindex="0"` with an accessible name).
- **Rank bracket filter** = the lowest `max` tier among the tournament's `player_rank_range` rules, or `open` when there is none. Other rule types do not define a bracket.
- **Finished tournaments on browse** are capped to the 12 most recent.
- **"Next cup"** = the earliest non-draft, non-cancelled, not-finished tournament starting after this one; none → a link to `/torneos`.
- **Match detail is public** for matches of non-draft tournaments that have at least one team; it shows teams, score, stats, VOD. It carries `noindex` and is not in the sitemap (low search value).
- **VOD links** are stored per match (`matches.vod_url`), set by moderators and admins, `https` only, rendered as plain links with `rel="noopener noreferrer nofollow"`; no embedding.
- **OG images** exist for tournaments and one site default; team, player and other pages use the default image.
- **Site origin** is the origin of `BETTER_AUTH_URL`; no new env var.
- **Event JSON-LD has no `endDate`** (the end time is unknowable); `eventAttendanceMode` is online.
- **No rank-history chart** on profiles; placements and current/peak rank only.
- **Sitemap** lists home, browse, privacy, every non-draft tournament, every team that is not an unkept auto-formed team, and every linked player, capped at 50,000 URLs.

---

## File Structure

```
src/shared/stage.ts                    tournamentStage, tournamentSchedule
src/shared/browse.ts                   BrowseTournament, rankBracketOf, browseSearchSchema, filterTournaments, groupForBrowse, FINISHED_LIMIT
src/shared/bracket-layout.ts           BracketViewMatch, layoutBracket (pure)
src/shared/twitch.ts                   twitchChannel, twitchPlayerSrc, twitchChatSrc
src/shared/seo.ts                      absoluteUrl, pageMeta, eventJsonLd, jsonLdString, sitemapXml, robotsTxt
src/shared/viewer-status.ts            statusChecklist
src/server/tournaments/browse.ts       listBrowseTournaments
src/server/tournaments/results.ts      getTournamentResults, getNextTournament
src/server/tournaments/viewer-status.ts getViewerTournamentStatus
src/server/bracket/bracket-view.ts     getBracketView
src/server/matchday/match-page.ts      loadMatchPage (moved out of matchday.functions.ts), setMatchVod in moderation.ts
src/server/identity/profile.ts, src/server/teams/teams.ts   history with placements
src/server/seo/og.ts, src/server/seo/sitemap.ts
src/server/db/schema/matchday.ts       matches.vod_url
src/routes/torneos.index.tsx, sitemap[.]xml.ts, robots[.]txt.ts, og.torneos.$slug[.]png.ts, og.default[.]png.ts
src/routes/torneos.$slug.tsx           stage-aware (rewritten around the stage components)
src/components/bracket/bracket-view.tsx
src/components/tournament/{twitch-embed,stage-live,stage-after,your-status,schedule,browse-list}.tsx
tests/shared/*.test.ts, tests/server/{tournaments,bracket,matchday,seo,identity,teams}/*.test.ts, tests/components/*.test.tsx
e2e/tournament-stages.spec.ts, e2e/seo.spec.ts, e2e/browse.spec.ts
```

---

### Task 1: Pure rules — stage, schedule, browse, bracket layout, Twitch

**Files:**
- Create: `src/shared/stage.ts`, `src/shared/browse.ts`, `src/shared/bracket-layout.ts`, `src/shared/twitch.ts`
- Modify: `src/shared/i18n/es-AR.ts`
- Test: `tests/shared/stage.test.ts`, `tests/shared/browse.test.ts`, `tests/shared/bracket-layout.test.ts`, `tests/shared/twitch.test.ts`

**Interfaces:**
- Consumes: `TournamentStatus`, `EligibilityRule`, `Tier`/`TIERS`, `MatchPhase`, `MatchStatus`, `checkInWindow` (Plan 5).
- Produces:
  ```ts
  // stage.ts
  type TournamentStage = "before" | "live" | "after";
  tournamentStage(status: TournamentStatus): TournamentStage | null;   // draft → null
  type ScheduleRow = { key: "registrationCloses" | "checkInOpens" | "checkInCloses" | "starts"; at: Date };
  tournamentSchedule(t: { registrationClosesAt: Date; startsAt: Date }): ScheduleRow[];   // chronological, via checkInWindow
  // browse.ts
  type RankBracket = Tier | "open";
  type BrowseTournament = { slug: string; title: string; edition: number; status: TournamentStatus; startsAt: Date;
    bracket: "double_elimination" | "single_elimination"; entryFeeArs: number; prizeGoalArs: number; prizeSplit: number[];
    teamCap: number; confirmedCount: number; rankBracket: RankBracket };
  const FINISHED_LIMIT = 12;
  rankBracketOf(rules: EligibilityRule[]): RankBracket;
  browseSearchSchema: z.ZodType<{ when?: "today" | "week" | "weekend"; format?: BrowseTournament["bracket"]; rank?: RankBracket }>;  // unknown values are dropped, never an error
  filterTournaments<T extends Pick<BrowseTournament, "startsAt" | "bracket" | "rankBracket">>(list: T[], filters: BrowseSearch, now: Date): T[];
  groupForBrowse<T extends Pick<BrowseTournament, "status" | "startsAt">>(list: T[], now: Date): { upcoming: T[]; live: T[]; finished: T[] };
  // bracket-layout.ts
  type BracketSlot = { registrationId: string | null; name: string | null; seed: number | null; score: number | null; winner: boolean };
  type BracketViewMatch = { matchId: string | null; phase: MatchPhase; round: number; number: number; bye: boolean; status: MatchStatus; bestOf: 1 | 3 | 5; slots: [BracketSlot, BracketSlot] };
  type RoundTitle = { key: "bracket.round.final" | "bracket.round.semifinal" | "bracket.round.quarterfinal" | "bracket.round.numbered" | "bracket.round.grandFinal" | "bracket.round.reset" | "bracket.round.thirdPlace"; n: number };
  type BracketSection = { id: "winners" | "losers" | "grand_final" | "main" | "third_place"; rounds: { round: number; title: RoundTitle; matches: BracketViewMatch[] }[] };
  layoutBracket(matches: BracketViewMatch[]): BracketSection[];
  // twitch.ts
  twitchChannel(streamUrl: string): string | null;
  twitchPlayerSrc(channel: string, parent: string): string;  twitchChatSrc(channel: string, parent: string): string;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `stage.test.ts`: `draft → null`; `registration_open`, `registration_closed`, `check_in → "before"`; `live → "live"`; `finished`, `cancelled → "after"`. `tournamentSchedule` for start 20:00Z and registration close 18:00Z returns `registrationCloses 18:00Z, checkInOpens 19:00Z, checkInCloses 19:50Z, starts 20:00Z` in that order.
  - `browse.test.ts` (now = `2026-10-21T15:00Z`, a Wednesday, 12:00 ART): `rankBracketOf([])`, a range with only `min`, and a `team_average_max` rule → `"open"`; a range with `max: DIAMOND IV` → `"DIAMOND"`; two ranges with max `PLATINUM` and `EMERALD` → `"PLATINUM"`. `when: "today"` keeps `2026-10-22T02:59Z` (23:59 ART) and drops `2026-10-22T03:00Z`; `"week"` keeps ART days today..today+6 and drops the 8th; `"weekend"` keeps `2026-10-24T21:00Z` (Saturday 18:00 ART) and `2026-10-26T02:59Z` (Sunday 23:59 ART), drops `2026-10-26T03:00Z`, and when `now` is a Saturday keeps that Saturday; format and rank filters combine with AND; no filters returns the input. `browseSearchSchema.parse({ when: "yesterday", rank: "GOLD" })` → `{ rank: "GOLD" }`. `groupForBrowse`: `registration_open|registration_closed|check_in` → upcoming ordered by `startsAt` ascending, `live` → live, `finished` → finished newest first; `draft` and `cancelled` dropped.
  - `bracket-layout.test.ts` (Review Focus 4; fixture helper builds `BracketViewMatch`es): an 8-team single elimination → one `main` section whose rounds are titled quarterfinal, semifinal, final, then a `third_place` section titled thirdPlace; a double elimination → `winners`, `losers`, `grand_final` in that order, the winners last round titled final, the losers rounds `numbered` with `n` = round number, grand final round 1 `grandFinal`, round 2 `reset`; sections without matches are omitted; matches inside a round are ordered by `number` and rounds ascending regardless of input order; a `bye: true` match is kept; a 2-team single elimination has a single round titled final.
  - `twitch.test.ts` (Review Focus 2): `https://www.twitch.tv/gorosei`, `https://twitch.tv/Gorosei/`, `twitch.tv/gorosei`, `https://m.twitch.tv/gorosei?foo=1` → `"gorosei"`/`"Gorosei"` (case kept); `""`, `"https://example.com/gorosei"`, `"javascript:alert(1)"`, `"https://www.twitch.tv/videos/123"`, `"https://www.twitch.tv/gorosei/clip/x"`, `"https://www.twitch.tv/a"` (too short), a 26-character name, `"https://twitch.tv.evil.com/gorosei"` → `null`. `twitchPlayerSrc("gorosei", "gorosei.gg")` is `https://player.twitch.tv/?channel=gorosei&parent=gorosei.gg&muted=true`; `twitchChatSrc` is `https://www.twitch.tv/embed/gorosei/chat?parent=gorosei.gg&darkpopout`; a `parent` containing `&`, `/` or spaces is URL-encoded.
- [ ] **Step 2:** Run `bun test tests/shared` → FAIL.
- [ ] **Step 3: Implement** the signatures above. ART is a fixed −03:00 offset: derive ART calendar days by shifting the instant 3 hours before taking its UTC date. `layoutBracket` maps phases to sections as `winners→winners`, `losers→losers`, `grand_final|reset→grand_final`, `main|final→main`, `third_place→third_place`; in `winners` and `main` the last round is `final`, the one before `semifinal`, the one before that `quarterfinal`, anything else `numbered`; in `losers` every round is `numbered`. Add `bracket.round.*`, `bracket.section.*`, `browse.*` and `stage.*` strings as later tasks need them.
- [ ] **Step 4:** Run `bun test tests/shared` → PASS.
- [ ] **Step 5: Commit** `feat: add stage, browse, bracket layout and Twitch rules`

### Task 2: SEO helpers

**Files:**
- Create: `src/shared/seo.ts`
- Test: `tests/shared/seo.test.ts`

**Interfaces:**
- Consumes: `TournamentStatus`.
- Produces:
  ```ts
  absoluteUrl(origin: string, path: string): string;   // origin without trailing slash + path starting with "/"
  type PageMetaInput = { origin: string; path: string; title: string; description: string; image?: string; noindex?: boolean; type?: "website" | "article" };
  pageMeta(input: PageMetaInput): { meta: Record<string, string>[]; links: { rel: string; href: string }[] };   // TanStack Start head() shape
  type EventInput = { origin: string; slug: string; title: string; edition: number; startsAt: Date; status: TournamentStatus;
    entryFeeArs: number; prizeGoalArs: number; description: string; imageUrl: string };
  eventJsonLd(input: EventInput): Record<string, unknown>;
  jsonLdString(value: unknown): string;
  type SitemapEntry = { path: string; lastmod: Date };
  sitemapXml(origin: string, entries: SitemapEntry[]): string;
  robotsTxt(origin: string): string;
  const MAX_SITEMAP_URLS = 50_000;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `pageMeta`: includes `title`, `description`, `og:title`, `og:description`, `og:type` (default `website`), `og:url` and a `canonical` link both absolute, `og:locale` `es_AR`, `og:site_name` `Gorosei`, `twitter:card` `summary_large_image` when an image is given (and `og:image`, `twitter:image`) and `summary` without; `noindex: true` adds `robots: "noindex,follow"`; a path with a query string keeps the canonical **without** the query.
  - `eventJsonLd` (Review Focus 5): `@context` `https://schema.org`, `@type` `Event`, `name` `"<title> #<edition>"`, `startDate` ISO with `Z`, `eventAttendanceMode` `https://schema.org/OnlineEventAttendanceMode`, `eventStatus` `https://schema.org/EventScheduled`, or `https://schema.org/EventCancelled` when `cancelled`; `location` is a `VirtualLocation` with the tournament URL; `organizer` is an `Organization` named Gorosei; `offers.price` is the fee as a string with `priceCurrency` `ARS`, `"0"` for a free tournament, `availability` `https://schema.org/InStock` only when `registration_open`, else `https://schema.org/SoldOut`; no `endDate`; `inLanguage` `es-AR`.
  - `jsonLdString` turns `<` into `<` (a title `</script><b>` can never close the tag), keeps `&`, quotes and emoji intact, and `JSON.parse` round-trips it.
  - `sitemapXml`: well-formed XML with the `http://www.sitemaps.org/schemas/sitemap/0.9` namespace, absolute `<loc>`, `<lastmod>` as ISO date (`YYYY-MM-DD`), `&`, `<` and `'` in a path escaped, and more than `MAX_SITEMAP_URLS` entries truncated to the limit.
  - `robotsTxt`: `User-agent: *`, `Disallow: /admin`, `/mod`, `/api/`, `/realtime`, and `Sitemap: <origin>/sitemap.xml`; nothing else is disallowed (pages that must not be indexed use `noindex`, which crawlers can only see if they may fetch the page).
- [ ] **Step 2:** Run `bun test tests/shared/seo.test.ts` → FAIL.
- [ ] **Step 3: Implement** the signatures above as pure functions with no dependency on the environment.
- [ ] **Step 4:** Run `bun test tests/shared/seo.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: add SEO helpers`

### Task 3: Browse, results and next-cup queries

**Files:**
- Create: `src/server/tournaments/browse.ts`, `src/server/tournaments/results.ts`
- Test: `tests/server/tournaments/browse.test.ts`, `tests/server/tournaments/results.test.ts`

**Interfaces:**
- Consumes: Task 1 (`BrowseTournament`, `rankBracketOf`, `FINISHED_LIMIT`), Plan 5 `brackets.final_standings`, `matches`, `splitPrize`.
- Produces:
  ```ts
  listBrowseTournaments(db: Db): Promise<BrowseTournament[]>;   // non-draft, non-cancelled; finished limited to the FINISHED_LIMIT most recent
  type ResultTeam = { registrationId: string; teamName: string; teamSlug: string; tag: string };
  type TournamentResults = {
    champion: ResultTeam | null;
    podium: { rank: 1 | 2 | 3; team: ResultTeam; prizeArs: number | null }[];   // ranks 1–3 present in the stored standings, prizeArs from prizeShares[rank-1] or null
    vods: { matchId: string; phase: MatchPhase; round: number; teams: [string, string]; url: string }[];   // matches with a vod_url, by round
  };
  getTournamentResults(db: Db, tournamentId: string, prizeShares: number[]): Promise<TournamentResults | null>;   // null unless the tournament is finished
  type NextCup = { slug: string; title: string; edition: number; startsAt: Date };
  getNextTournament(db: Db, current: { id: string; startsAt: Date }): Promise<NextCup | null>;
  ```

- [ ] **Step 1: Write the failing tests** (fixtures from `tests/helpers/competition.ts`; `finalStandings` and `vod_url` are written directly):
  - `browse.test.ts`: drafts and cancelled tournaments are excluded; `confirmedCount` counts only `confirmed` registrations; `rankBracket` follows the rules; with 15 finished tournaments only the 12 most recent come back, together with every non-finished one.
  - `results.test.ts` (Review Focus 1, 3): a finished tournament with standings 1–3 → champion and a podium of three with `prizeArs` `[210000, 90000, null]` for shares `[210000, 90000]`; standings with ranks 1–2 only → a podium of two; **finished with no `final_standings` → `champion: null`, `podium: []`** (results object, not null); a `live` or `cancelled` tournament → `null`; `vods` lists only matches with a `vod_url`, ordered by round then number, with team names (an empty string for a missing team); `getNextTournament` returns the earliest later `registration_open|registration_closed|check_in|live` tournament, ignores drafts, cancelled and finished ones and earlier ones, and returns `null` when there is none.
- [ ] **Step 2:** Run `bun test tests/server/tournaments/browse.test.ts tests/server/tournaments/results.test.ts` → FAIL (the `vod_url` column arrives in Task 4: the VOD assertions are added there; here `vods` is `[]`).
- [ ] **Step 3: Implement** the signatures above with plain Drizzle selects; `confirmedCount` through one grouped query, not one per tournament.
- [ ] **Step 4:** Run the two test files → PASS.
- [ ] **Step 5: Commit** `feat: add browse, results and next-cup queries`

### Task 4: Bracket view, VOD links and the public match page

**Files:**
- Create: `src/server/bracket/bracket-view.ts`, `src/server/matchday/match-page.ts`
- Modify: `src/server/db/schema/matchday.ts` (`matches.vod_url text null`, migration via `bun run db:generate`), `src/server/bracket/bracket.ts` (`MatchView.vodUrl: string | null`), `src/server/matchday/moderation.ts` (`setMatchVod`), `src/server/matchday/matchday.functions.ts` (`getMatchPage` calls `loadMatchPage`; new `setMatchVodFn`), `src/server/tournaments/results.ts` (`vods` reads the column), `src/shared/i18n/es-AR.ts`
- Test: `tests/server/bracket/bracket-view.test.ts`, `tests/server/matchday/match-page.test.ts`, `tests/server/matchday/vod.test.ts`, `tests/server/tournaments/results.test.ts`

**Interfaces:**
- Consumes: Task 1 (`BracketViewMatch`), Plan 5 (`listEngineMatches`, `brackets`, `matches`, `getMatchView`, `canSeeMatchPrivate`, `listMessages`, `writeAudit`).
- Produces:
  ```ts
  getBracketView(db: Db, tournamentId: string): Promise<{ bracket: "double_elimination" | "single_elimination"; matches: BracketViewMatch[] } | null>;   // null without a stored bracket
  // seed = participant index + 1 in brackets.data (participants are inserted in seed order); a bye is an archived engine match that has exactly one team
  setMatchVod(db: Db, moderatorId: string, matchId: string, url: string | null): Promise<{ ok: true } | { ok: false; reason: "not_found" | "invalid_url" }>;   // https only, ≤ 300 chars, null clears; audit match.vod_set
  loadMatchPage(db: Db, matchId: string, viewer: { userId: string; role: UserRole } | null, now: Date): Promise<MatchPage | null>;
  // same shape getMatchPage returned (match, tournament, messages, captainSide, viewer); for anyone who is not a participant or moderator:
  // lobby null, reports [], messages [], captainSide null; null when the match has no team yet or its tournament is a draft
  ```
  `getMatchPage` no longer rejects signed-out visitors: it passes `null` as the viewer. Chat, report and lobby actions keep their own role checks.

- [ ] **Step 1: Write the failing tests** (live-tournament fixture as in `tests/server/matchday/moderation.test.ts`):
  - `bracket-view.test.ts`: a 5-team double elimination has exactly one `bye` match in round 1 with one filled slot; seeds on slots match `seedOrder` (best team seed 1); live and completed matches carry their `matches.id` and status, byes carry `matchId: null`; scores and `winner` flags appear on completed matches; a tournament with no `brackets` row → `null`; a 2-team single elimination → one final plus a third-place match only if the engine created it.
  - `vod.test.ts`: a moderator sets `https://www.youtube.com/watch?v=abc` → stored and audited; `http://…`, `javascript:alert(1)`, `//example.com`, a 301-character URL → `invalid_url` and nothing stored; `null` clears; unknown match → `not_found`; `getMatchView(...).vodUrl` returns it to everybody.
  - `match-page.test.ts` (Review Focus 3): a signed-out viewer gets the match with teams, score, stats and VOD but `lobby: null`, `reports: []`, `messages: []`, `captainSide: null` while a lobby, two reports and chat lines exist; an unrelated signed-in player is the same; a captain and a moderator still get everything (regression); a `waiting` match with no teams → `null`; a match whose tournament is a draft → `null`; a bad match id → `null`.
  - `results.test.ts`: `vods` now returns the stored URLs.
- [ ] **Step 2:** Run `bun test tests/server/bracket tests/server/matchday tests/server/tournaments/results.test.ts` → FAIL.
- [ ] **Step 3: Implement** the signatures above. Read the current private `matchPage` in `matchday.functions.ts` first and move it into `match-page.ts` unchanged except for the public branch. `getBracketView` reads `brackets.data` and joins `matches` by `bm_match_id`; it must work for completed tournaments.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add public bracket view, VOD links and public match page`

### Task 5: Player and team history with placements

**Files:**
- Modify: `src/server/identity/profile.ts`, `src/server/teams/teams.ts`, `src/server/teams/teams.functions.ts` (`getTeamPage` returns `history`), `src/routes/jugador.$riotId.tsx`, `src/routes/equipos.$slug.tsx`, `src/shared/i18n/es-AR.ts`
- Create: `src/shared/placement.ts`
- Test: `tests/shared/placement.test.ts`, `tests/server/identity/profile.test.ts`, `tests/server/teams/teams.test.ts`

**Interfaces:**
- Consumes: Plan 5 `brackets.final_standings`.
- Produces:
  ```ts
  // shared/placement.ts
  placementLabel(rank: number | null, status: TournamentStatus): { key: "placement.champion" | "placement.second" | "placement.third" | "placement.nth" | "placement.inProgress" | "placement.none"; n?: number };
  // profile.ts: PublicProfile.tournaments items gain { status: TournamentStatus; placement: number | null; teamSlug: string }
  // teams.ts
  type TeamHistoryItem = { title: string; edition: number; slug: string; startsAt: Date; status: TournamentStatus; placement: number | null };
  getTeamHistory(db: Db, teamId: string): Promise<TeamHistoryItem[]>;   // confirmed registrations, newest first; placement from final_standings
  ```

- [ ] **Step 1: Write the failing tests:** `placement.test.ts`: `(1, finished)` → champion, `(2, …)` second, `(3, …)` third, `(7, finished)` → `nth` with `n: 7`, `(null, finished)` → `none`, any status other than finished/cancelled → `inProgress`, `(null, cancelled)` → `none`. Profile: a player on a team that won shows `placement: 1` for that tournament and `null` for one still live; unconfirmed, withdrawn and forfeited registrations stay out (as before). Team: `getTeamHistory` lists the team's confirmed registrations with placements, newest first; a team with none → `[]`; an auto-formed team's history works the same.
- [ ] **Step 2:** Run `bun test tests/shared/placement.test.ts tests/server/identity tests/server/teams` → FAIL.
- [ ] **Step 3: Implement** the signatures above; one query for standings per call, not one per row. Profile page shows the placement beside each tournament (champion in display type, cobalt light; no medals or trophy imagery); the team page gains a "Historial" section for everyone, below the roster.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: show placements on player and team pages`

### Task 6: Open Graph images

**Files:**
- Create: `src/server/seo/og.ts`, `src/routes/og.torneos.$slug[.]png.ts`, `src/routes/og.default[.]png.ts`
- Modify: `package.json` / `bun.lock` (`bun add satori @resvg/resvg-js`)
- Test: `tests/server/seo/og.test.ts`

**Interfaces:**
- Consumes: `formatCupDay`, `formatCupTime`, `formatArs`, `splitPrize`, the self-hosted `@fontsource/big-shoulders-display` (900) and `@fontsource/hanken-grotesk` (700) `.woff` files (satori reads `.woff`, not `.woff2`).
- Produces:
  ```ts
  type OgInput =
    | { kind: "upcoming"; title: string; edition: number; startsAt: Date; status: TournamentStatus; championPrizeArs: number }
    | { kind: "finished"; title: string; edition: number; champion: string | null; championPrizeArs: number };
  renderTournamentOg(input: OgInput): Promise<Uint8Array>;   // PNG, 1200×630
  renderDefaultOg(): Promise<Uint8Array>;
  ogTitleFontSize(titleLength: number): number;   // shrinks for long titles so two lines always fit
  // routes: GET /og/torneos/<slug>.png → image/png, Cache-Control "public, max-age=300"; 404 for unknown and draft tournaments; GET /og/default.png
  ```
  Layout follows `DESIGN.md`: near-black surface with the cobalt stage glow, red status tag (the only red), display-type title, the champion share of the prize in cobalt light as the largest number ("Premio para el campeón"), a caption bar with day and time in ART; no Riot marks, no trophy art. Colors are hex constants in `og.ts` (satori cannot read `oklch`).

- [ ] **Step 1: Write the failing tests:** both renderers return bytes starting `89 50 4E 47 0D 0A 1A 0A` with IHDR width 1200 and height 630; Review Focus 5: an 80-character title, a title with `<`, `&`, quotes, `ñ`, accents and an emoji, and a 0 prize all render without throwing; `ogTitleFontSize` is monotonically non-increasing and never below 56; `finished` with `champion: null` renders; the hex constants match the `DESIGN.md` tokens (surface, cobalt, cobalt-light, signal, ink) within a small tolerance via `culori` (same technique as `tests/shared/theme.test.ts`); the route returns 404 for a draft tournament and for an unknown slug, `image/png` for a registration-open one (Review Focus 3).
- [ ] **Step 2:** Run `bun test tests/server/seo/og.test.ts` → FAIL.
- [ ] **Step 3: Implement** with `satori` (JSX-free element objects) rasterized by `Resvg`; load the font files once and keep them in memory; cache rendered PNGs in a small in-process map (50 entries) keyed by the JSON of the input.
- [ ] **Step 4:** Run `bun test` → PASS; run `bun run build && bun run start`, fetch `/og/torneos/<slug>.png` and confirm it is a PNG (the native `resvg` binding must survive the production bundle; if the build bundles it, mark `@resvg/resvg-js` and `satori` external for SSR in `vite.config.ts`).
- [ ] **Step 5: Commit** `feat: render Open Graph images for tournaments`

### Task 7: Sitemap, robots and head wiring

**Files:**
- Create: `src/server/seo/sitemap.ts`, `src/routes/sitemap[.]xml.ts`, `src/routes/robots[.]txt.ts`
- Modify: `src/server/viewer.functions.ts` (`getSiteOrigin`), `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/privacidad.tsx`, `src/routes/equipos.$slug.tsx`, `src/routes/jugador.$riotId.tsx`, `src/routes/partidas.$matchId.tsx`, `src/routes/ingresar.tsx`, `src/routes/vincular-riot.tsx`, `src/routes/mis-equipos.tsx`, `src/routes/equipos.nuevo.tsx`, `src/routes/torneos.$slug_.inscribir.tsx`, `src/routes/torneos.$slug_.agentes-libres.tsx`, `src/server/tournaments/tournaments.functions.ts`, `src/shared/i18n/es-AR.ts`
- Test: `tests/server/seo/sitemap.test.ts`, `tests/server/seo/site-origin.test.ts`

**Interfaces:**
- Consumes: Task 2 (`pageMeta`, `sitemapXml`, `robotsTxt`, `eventJsonLd`, `jsonLdString`).
- Produces:
  ```ts
  listSitemapEntries(db: Db): Promise<SitemapEntry[]>;   // "/", "/torneos", "/privacidad", /torneos/<slug>, /equipos/<slug>, /jugador/<riotIdSlug>; lastmod from updatedAt / latest activity
  getSiteOrigin(): Promise<string>;   // server function: new URL(BETTER_AUTH_URL).origin
  ```
  Public pages call `pageMeta` in `head`, taking `origin` from their loader data (the loaders that already call a server function include `origin`; static pages call `getSiteOrigin`). `noindex` pages: `/ingresar`, `/vincular-riot`, `/mis-equipos`, `/equipos/nuevo`, the register page, the free-agent page and every `/partidas/$matchId`.

- [ ] **Step 1: Write the failing tests:** `sitemap.test.ts` (Review Focus 3): drafts are absent; a registration-open tournament, a finished one, a team, a linked player appear with absolute-path entries; an auto-formed team that was not kept is absent and appears once kept; matches and `/admin` URLs are never listed; entries are unique. `site-origin.test.ts`: `BETTER_AUTH_URL=https://gorosei.gg/app/` → `https://gorosei.gg`.
- [ ] **Step 2:** Run `bun test tests/server/seo` → FAIL.
- [ ] **Step 3: Implement** the signatures above; the two routes answer `GET` with `application/xml; charset=utf-8` and `text/plain; charset=utf-8` and `Cache-Control: public, max-age=3600`; the root `head` keeps the global defaults and sets the default OG image `/og/default.png`.
- [ ] **Step 4:** Run `bun test` → PASS; run `bun run typecheck` → clean.
- [ ] **Step 5: Commit** `feat: add sitemap, robots and page meta`

### Task 8: Browse page and navigation

**Files:**
- Create: `src/routes/torneos.index.tsx`, `src/components/tournament/browse-list.tsx`
- Modify: `src/server/tournaments/tournaments.functions.ts` (`getBrowsePage`), `src/components/site/site-header.tsx` (a "Torneos" link), `src/routes/index.tsx` (a link to `/torneos` under the call to action), `src/shared/i18n/es-AR.ts`, `e2e/public-routes.ts` (`/torneos`)
- Test: `tests/server/tournaments/browse-page.test.ts`, `e2e/browse.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 3 (`browseSearchSchema`, `filterTournaments`, `groupForBrowse`, `listBrowseTournaments`).
- Produces:
  ```ts
  getBrowsePage(input: BrowseSearch): Promise<{ origin: string; filters: BrowseSearch; upcoming: BrowseTournament[]; live: BrowseTournament[]; finished: BrowseTournament[]; hasAny: boolean }>;   // server function; filtering and grouping happen on the server
  ```
  The route's `validateSearch` uses `browseSearchSchema`. Filters are a plain `<form method="get">` of three selects and an apply button, so they work without JavaScript; each section is a list of rows (date caption block, title and edition, format, rank bracket, fee, prize, `confirmedCount/teamCap`, status), upcoming first, then "En vivo", then "Finalizados"; an empty filter result says so and links to clear it; with no tournament at all the page shows the landing's "no cup open" copy. At most one red element per screen: the status tags use the existing `TournamentStatusTag` only on the live and open rows' status, and there is no primary button.

- [ ] **Step 1: Write the failing tests:** `browse-page.test.ts` — `getBrowsePage({ rank: "DIAMOND" })` returns only matching tournaments in the right sections with `filters` echoed; `hasAny` is `false` on an empty database; a registration-open tournament lands in `upcoming` and a live one in `live`. `e2e/browse.spec.ts` (JavaScript disabled): `/torneos` lists the seeded open cup first, then the live one, then the finished one; `?format=single_elimination` hides a double-elimination cup and shows the "clear filters" link; the header "Torneos" link navigates there; no horizontal scroll at 320 px (`document.documentElement.scrollWidth <= innerWidth`); the Riot notice is present.
- [ ] **Step 2:** Run `bun test tests/server/tournaments/browse-page.test.ts` → FAIL.
- [ ] **Step 3: Implement** the server function, route and component following `DESIGN.md`.
- [ ] **Step 4:** Run `bun test` → PASS; run `bunx playwright test e2e/browse.spec.ts` → PASS.
- [ ] **Step 5: Commit** `feat: add tournament browse page`

### Task 9: "Your status" checklist

**Files:**
- Create: `src/shared/viewer-status.ts`, `src/server/tournaments/viewer-status.ts`, `src/components/tournament/your-status.tsx`
- Modify: `src/server/tournaments/tournaments.functions.ts` (`getViewerStatus`), `src/shared/i18n/es-AR.ts`
- Test: `tests/shared/viewer-status.test.ts`, `tests/server/tournaments/viewer-status.test.ts`

**Interfaces:**
- Consumes: Plan 3/4/5 tables (`registrationPlayers`, `registrations`, `entryPayments`, `poolEntries`, `checkIns`), `ROSTER_STARTERS`.
- Produces:
  ```ts
  type StatusStep = { id: "riot" | "team" | "payment" | "check_in"; state: "done" | "pending" | "todo"; progress?: { have: number; need: number } };
  statusChecklist(i: { riotLinked: boolean; free: boolean; inPool: boolean; registration: { starters: number; paid: number; status: RegistrationStatus } | null;
    tournamentStatus: TournamentStatus; checkedIn: boolean }): StatusStep[];
  // riot: done | todo. team: done at 5/5 starters, pending below (progress), todo with neither registration nor pool; an unplaced pool player is pending.
  // payment: omitted when free; done when the registration is confirmed or paid ≥ 5, otherwise pending with progress; todo without a registration.
  // check_in: only when tournamentStatus is check_in or live; done once checked in, else pending.
  type ViewerTournamentStatus = { riotLinked: boolean; inPool: boolean; registration: { teamName: string; teamSlug: string; starters: number; paid: number; status: RegistrationStatus } | null; checkedIn: boolean };
  getViewerTournamentStatus(db: Db, userId: string, tournamentId: string): Promise<ViewerTournamentStatus>;
  ```

- [ ] **Step 1: Write the failing tests:** `viewer-status.test.ts` — Riot not linked → `riot: todo`, team and payment `todo`; linked with a 4/5 roster and 3 paid → team `pending {4,5}`, payment `pending {3,5}`; a confirmed registration → all `done`; free tournament → no `payment` step; `check_in` appears only from `check_in` status on; pool player → team `pending`. Server: a player on a registration, a withdrawn registration (ignored), a pool-only player, a checked-in player, a user without a Riot account; the function only ever reads the given user's own rows.
- [ ] **Step 2:** Run `bun test tests/shared/viewer-status.test.ts tests/server/tournaments/viewer-status.test.ts` → FAIL.
- [ ] **Step 3: Implement** the signatures above; the component is a plain ordered list with a visually-hidden state word per item (done / pending / to do), not color alone; it renders only for signed-in viewers and links each pending step to where it is fixed (`/vincular-riot`, the register page, the team page).
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add your-status checklist`

### Task 10: Bracket and Twitch components

**Files:**
- Create: `src/components/bracket/bracket-view.tsx`, `src/components/tournament/twitch-embed.tsx`
- Modify: `src/styles.css` (bracket column and scroll-region styles), `src/shared/i18n/es-AR.ts`
- Test: `tests/components/bracket-view.test.tsx`, `tests/components/twitch-embed.test.tsx` (`renderToStaticMarkup`)

**Interfaces:**
- Consumes: Task 1 (`layoutBracket`, `twitchChannel`, `twitchPlayerSrc`, `twitchChatSrc`).
- Produces:
  ```tsx
  BracketView(props: { bracket: "double_elimination" | "single_elimination"; matches: BracketViewMatch[]; highlightRegistrationId?: string | null }): JSX.Element;
  TwitchEmbed(props: { streamUrl: string }): JSX.Element;
  ```
  `BracketView` renders each `BracketSection` as `<section id="<section id>">` with an anchor nav above (Winners / Losers / Grand final, or Bracket / Tercer puesto), rounds as columns inside `<div role="region" aria-label tabindex="0">` that scrolls horizontally, matches as two-row scoreboards (seed, name, score; the winner in display weight, no side-stripe borders), a match with `matchId` is an `<a href="/partidas/<id>">`, a bye shows "Pasa por bye" under the single team, empty slots read "A definir", in-play matches carry the label "En juego" (cobalt light, not red), the viewer's own team is marked with text and underline. `TwitchEmbed` renders on the server only a link to the stream (when `streamUrl` is a real `https` URL) and, after mount, the player iframe and chat iframe with `parent` from `location.hostname`, `title` attributes and `loading="lazy"`; with a non-Twitch URL it renders only the link (or nothing for junk).

- [ ] **Step 1: Write the failing tests:** `bracket-view.test.tsx` (Review Focus 4) — an 8-team double-elimination fixture renders three sections with anchors and every non-bye match as a link to `/partidas/<id>`; a bye match renders "Pasa por bye" and no link; empty slots render "A definir"; a 24-character team name keeps `[overflow-wrap:anywhere]`; the highlighted registration is underlined and has a text marker; no element uses a `grid-cols` utility for matches (a bracket is columns, not a card grid) and no element has the `bg-signal` class. `twitch-embed.test.tsx` (Review Focus 2) — server markup contains no `<iframe`; `https://www.twitch.tv/gorosei` renders a link; `javascript:alert(1)` renders no anchor at all; `https://example.com/x` (https, not Twitch) renders a link but never an iframe.
- [ ] **Step 2:** Run `bun test tests/components` → FAIL.
- [ ] **Step 3: Implement** the components following `DESIGN.md` (flat, hairline `line` borders, display type for scores, 4 px corners).
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add bracket and Twitch components`

### Task 11: Stage-aware tournament page and end-to-end

**Files:**
- Create: `src/components/tournament/{stage-live,stage-after,schedule}.tsx`, `e2e/tournament-stages.spec.ts`, `e2e/seo.spec.ts`
- Modify: `src/routes/torneos.$slug.tsx`, `src/server/tournaments/tournaments.functions.ts` (`getTournamentPage` returns `origin`, `stage`, `schedule`, `bracket`, `results`, `next`, `viewerStatus`, `streamChannel`), `src/routes/index.tsx` (landing keeps its own hero), `src/shared/i18n/es-AR.ts`, `e2e/helpers/tournaments.ts`
- Test: `tests/server/tournaments/tournament-page.test.ts`

**Interfaces:**
- Consumes: Tasks 1–10, Plan 5 `MatchDay`/`CheckInPanel`/`useRealtime`.
- Produces: `getTournamentPage` data loaded only as needed: `bracket` when the tournament is `live` or `finished` (or `check_in` with a bracket), `results` and `next` when `after`, `viewerStatus` for signed-in viewers during `before`. The page by stage:
  - **before:** the current hero and actions, then `YourStatus`, `MatchDay` (check-in panel, primary during `check_in`), prize meter beside the fee and how to pay, `Schedule`, eligibility, teams, rules; the bracket section says it is built when check-in closes.
  - **live:** compact hero (status tag "En vivo", title, no countdown), `TwitchEmbed` (player and chat side by side from `lg`, stacked on phones), "En juego" list of in-play matches linking to match pages, `MatchDay`, `BracketView` with the viewer's team highlighted, then schedule, teams, rules.
  - **after:** champion banner (team name linking to `/equipos/<slug>`, prize won from `prizeShares[0]` in display type cobalt light, 2nd and 3rd below), `BracketView`, VOD links, the one primary button "Siguiente copa →" to `/torneos/<next slug>` (or `/torneos`), then teams and rules; `cancelled` shows the cancelled tag and note, no champion, the same next-cup button.
  - Every stage: `useRealtime(["tournament:<id>"])` while `check_in` or `live`; `head` uses `pageMeta` with the tournament OG image and an `application/ld+json` script from `eventJsonLd` + `jsonLdString`.

- [ ] **Step 1: Write the failing tests:** `tournament-page.test.ts` (Review Focus 1) — registration-open: no bracket, no results; live with a stored bracket: `bracket.matches` present and `streamChannel` from the URL; **live without a `brackets` row** → `bracket: null` and no throw; finished with standings → `results.champion`, `next` set when a later cup exists; finished without standings → `results.champion: null`; cancelled → no `results`, `next` set; a draft slug → not found. E2E `tournament-stages.spec.ts` (JavaScript disabled for the first block): the open cup shows hero, countdown date, register action, schedule, prize shrink warning and canonical link, and its JSON-LD parses as `Event` with `offers.price`; a signed-in player sees the checklist with the right step states; the live cup shows the stream link (no iframe without JavaScript), the "En juego" list and the bracket with sections, and with JavaScript the iframes carry `parent=localhost`; clicking a completed match opens the public match page while signed out and shows no lobby or chat; the finished cup shows the champion, prize, top 3, VOD link and "Siguiente copa →"; 320 px has no horizontal page scroll on all three stages. `e2e/seo.spec.ts`: `/sitemap.xml` lists the seeded tournament, team and player and not a draft; `/robots.txt` points at the sitemap; `/og/torneos/<slug>.png` is a PNG and a draft slug is 404; the tournament page has `og:image` pointing at it.
- [ ] **Step 2:** Run `bun test tests/server/tournaments/tournament-page.test.ts` → FAIL.
- [ ] **Step 3: Implement** the loader and the three stage compositions around the existing blocks; keep the red budget: status tag plus one primary action per stage.
- [ ] **Step 4:** Run `bun test` → PASS; run `bun run typecheck` → clean; run `bun run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat: make the tournament page stage-aware`

---

## Self-review notes

- Spec coverage: §5.2 browse + filters → Tasks 1, 3, 8; §5.8 before/during/after, Twitch embed + chat, live bracket, champion banner, VODs, next cup, "Your status" → Tasks 9–11; §5.7 match detail (stats, VOD) public → Task 4; §5.9 player and team profiles with history → Task 5; §6 SEO (titles, descriptions, OG images, sitemap, schema.org `Event`) → Tasks 2, 6, 7; server-rendered/no-JS reading and 320 px → Tasks 10–11 and e2e. Deferred on purpose and listed in Builder's calls: multi-stream selector, rank-history chart, team logos, indexing of match pages.
- Type consistency: `BracketViewMatch`/`BracketSlot` are defined in Task 1 and produced unchanged by `getBracketView` (Task 4) and consumed by `BracketView` (Task 10); `BrowseTournament` (Task 1) is what `listBrowseTournaments` (Task 3) returns and `getBrowsePage` (Task 8) serves; `PageMetaInput`/`EventInput` (Task 2) are the only inputs Tasks 7 and 11 pass; `placementLabel` (Task 5) reads the same `final_standings` shape `getTournamentResults` (Task 3) reads.
- Order: Task 3 asserts `vods: []` until Task 4 adds `matches.vod_url`; Task 4 extends `results.ts` and its test.
