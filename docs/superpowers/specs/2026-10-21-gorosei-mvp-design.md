# Gorosei — MVP Design

*Working name taken from the repo folder. Date: 2026-10-21.*

## 1. Intent

A League of Legends tournament platform for the **LAS** server. The long-term vision: anyone can create tournaments and ladders, prize pools are crowdfunded in-platform, solo players can be recruited from a pool, LoL rank earns benefits, and eventually Riot officially supports hosting tournaments on it.

**The MVP is narrower:** a platform where *we* host our own recurring tournaments (at least one every week), players link their Riot account, form teams, register, check in, play, and follow the bracket and the streamed matches live.

**Why now:** Battlefy (the reference product) is effectively dead for LAS — its LAS listings are months-old finished events. The gap: an LAS-first, Spanish-language platform where there is **always** a tournament open, because we run one every week.

**What makes it different from Battlefy** (findings from inspecting Battlefy, see Appendix A):
- The tournament page is **stage-aware**: it is an ad landing page before the event, a live broadcast page (embedded stream + chat + live bracket) during it, and a results page pointing to the next cup after it.
- Riot identity and rank are first-class (eligibility rules, profiles), not an afterthought.
- A distinctive, memorable visual identity — explicitly not a generic template look.

## 2. Goals, non-goals, anti-goals

**Goals (MVP)**
1. Admins (us) can run a weekly tournament with near-zero manual setup via recurring templates.
2. A new player can arrive from an Instagram ad or a shared link, sign up, and understand the tournament (details, rules, prize pool, date) in one visit.
3. Teams can be created, players invited, and rosters registered for tournaments.
4. Solo players can enter a free-agent pool and get onto a team (three ways, §5.5).
5. Riot account linking; rank used for per-tournament eligibility rules.
6. Double-elimination (and single-elimination) brackets, viewable live.
7. Match day: check-in, lobby instructions, result reporting, moderator confirmation, in-platform match chat for problems.
8. Streams embedded on the tournament page.
9. Fast, pleasant, visually clean, **strong SEO** (organic discovery matters).

**Non-goals (explicitly out of the MVP)**
- Public tournament creation (no public CRUD; only admins create tournaments).
- Ladders.
- Any in-platform payment, purchase or crowdfunding. Entry fees are paid outside (Mercado Pago) and marked paid manually by an admin.
- Regions other than LAS. No region filter anywhere.
- Rank-based perks/benefits (badges, pool priority, etc.).
- Our own stream chat (we use Twitch's embedded chat).
- WhatsApp/Discord notifications.
- English UI (but i18n-ready, §6).

**Anti-goals (would be a failure even if it works)**
- A generic, "AI-slop" look: card grids everywhere, purple gradients, interchangeable dashboard layouts. It must look unique and memorable.
- A dead-looking platform: there must never be a state where no tournament is open or upcoming.
- Players surprised by prize amounts: the "prizes shrink to the real pool" rule must be impossible to miss before paying.

## 3. Constraints

- **Server:** LAS only.
- **Riot API access is not yet granted.** The user will apply for: Riot Sign On (RSO), a production API key, and Tournament API access. **Everything must work in a fallback mode without RSO and without the Tournament API**, and switch to the Riot-powered path when approved (§5.10).
- **Public launch waits for a Riot production API key.** Development uses a Riot development key. There is **no** "no-API" mode: Riot ID verification, rank polling and eligibility always use the Riot API. The fallback mode below covers only RSO and the Tournament API being unavailable.
- **No launch date.** Priority is getting the full MVP working right, not shipping early; ordering the work is left to the plan.
- **Riot API returns current rank only**, not peak rank. "Peak this season" must be tracked by us (§5.4). No scraping third-party sites (op.gg etc.).
- **Payments outside the platform** (Mercado Pago); admins mark payments manually.
- **Riot community competition guidelines:** the current global LoL Esports community competition guidelines (checked 2026-10-21) state no fixed caps on entry fees or prize pools, so the entry-fee → prize-pool model is permitted. Re-check the live page before each Riot application and before launch; some organizations fall outside the community license.
- **Language:** UI in Spanish (Argentina) for the MVP; all strings go through an i18n layer so English can be added.
- **Timezone:** display in ART (America/Argentina/Buenos_Aires); store UTC.

## 4. Users and roles

- **Visitor** — not signed in. Can browse tournaments, tournament pages, brackets, streams, profiles, teams.
- **Player** — signed in with a linked Riot account. Can create/join teams, register, enter the free-agent pool, check in, use match chat.
- **Captain** — a player who owns a team (or was assigned captain of an auto-formed team). Manages roster/invites, registers the team, reports results, decides short-handed play at check-in.
- **Moderator** — runs match day: creates lobbies (fallback), confirms results, resolves disputes in match chat, can override results, swap players, reset matches.
- **Admin** — everything a moderator can do, plus: tournament templates and tournaments, eligibility rules, marking payments, entry credits, manual rank overrides, eligibility exceptions.

## 5. Functional design

### 5.1 Sign-up and Riot account linking

- **Target path (after Riot approval):** sign up/in with Riot Sign On only — one click, and the account is linked.
- **Fallback path (now):** sign up with Discord or email, then **verify Riot ID ownership**: the player enters their Riot ID (`name#tag`), we ask them to set a specific random profile icon, and we confirm it via the Riot API, then they can change it back.
- A player cannot register for tournaments or enter a pool without a verified Riot account.
- One Riot account per platform account and vice versa.

### 5.2 Tournaments and the browse page

- Browse lists open/upcoming tournaments first, then live, then recent finished. No region filter (everything is LAS). Filters worth having: date (today / this week / this weekend), format, rank bracket. *(Exact filters: builder's call.)*
- Every tournament has: title, edition number, date/time, format (5v5 Summoner's Rift; draft mode, e.g. Tournament Draft), bracket type, best-of per round (and for finals), team cap, roster size (5 + 0–2 subs), eligibility rules, rank source, entry fee, prize pool goal and split, schedule (registration open/close, check-in open/close, round start times), rules text, stream channel(s).
- Tournament lifecycle states: `draft → registration_open → registration_closed → check_in → live → finished` (plus `cancelled`). The tournament page renders differently per state (§5.8).

### 5.3 Teams, invites, registration

- Any player can create a team (name, tag, logo). Creator is captain. Captain invites players (by Riot ID or platform username) or accepts join requests.
- A team registers for a tournament; every roster change re-validates against that tournament's eligibility rules (§5.4) and shows a clear message on failure (e.g. "Your roster breaks: max 1 player above Emerald").
- **Payment** (outside the platform via Mercado Pago; an admin marks each payment):
  - Each tournament sets a **fee per player**. A team may pay any mix of individual and group payments; the admin records which players a payment covers.
  - **Subs don't pay.**
  - A team is **confirmed once 5 players have paid**. A free agent's prior individual payment counts toward whichever team they join.
  - **Unconfirmed teams don't hold a cap slot.** At registration close, unconfirmed teams are dropped and their partial payments become **entry credits**.
  - A team that **withdraws or forfeits at check-in gets no refund or credit.**
  - If **we cancel** a tournament, every paid player gets an entry credit.
  - The UI shows payment progress (e.g. "3/5 paid") and how to pay.
- The prize pool is the sum of paid entry fees. If the goal isn't reached the tournament still runs and prizes are paid out of the real pool by the configured split. This must be shown prominently next to the pay instructions and the prize meter.
- Team cap: when full, further teams go to a registration waitlist *(waitlist behavior for teams is the builder's call)*.

### 5.4 Eligibility rules (per tournament, dynamic)

Eligibility is **configured per tournament, never platform-wide**. A tournament has an ordered list of rules; a team (and each player joining it) must pass all of them. Rules are stored as data (typed JSON with a discriminator), evaluated by one engine, so new rule types can be added without schema changes.

Initial rule types:
- **Per-player rank range** — min and/or max tier/division.
- **Team average cap** — average roster rank at or below X.
- **Point budget** — rank → points table (configurable), roster total ≤ N.
- **At most N players above X.**
- **Anti-smurf minimums** — account level ≥ N, ranked games this season ≥ N.
- **Roster composition** — roster size, number of subs, whether subs count toward team rules.

**Rank source** (chosen by admin per tournament, default = **peak this season**):
- *Current* solo/duo rank at registration time, or
- *Peak this season* = the highest solo/duo rank **our platform has observed** for that account this season. We poll linked accounts periodically and store a rank history; for a new user, peak = current at linking time.
- Admins can manually override a player's effective rank (e.g. obvious smurfs) and grant per-team eligibility exceptions. Both are logged.

**When eligibility is checked and frozen** *(my call)*: eligibility is evaluated when a player joins a roster, when the team registers, and on every roster change, using a **rank snapshot taken at that moment** and stored on the registration. Once a team is confirmed (paid), later rank polling does **not** knock it out. Rosters lock when check-in opens; after that only moderators can swap players (re-validated against the snapshots).

The same engine filters the free-agent pool: players only see tournaments and teams they're eligible for, and invites that would break a team's eligibility cannot be accepted.

### 5.5 Free-agent pool

A solo player enters a tournament's pool by paying the entry fee **individually before entering** (admin marks paid). In the pool they list their preferred roles in order (top/jungle/mid/bot/support). Three ways onto a team:
1. **Hand-pick a team** missing players → send a join request → captain accepts/declines.
2. **Get recruited** — captains browse the pool (filter by role, rank) and send invites.
3. **Auto-place** — when **registration closes**, the system forms 5-player teams from remaining auto-place players, balancing roles and guaranteeing each team passes the tournament's eligibility rules. The **highest-ranked player becomes captain**. Everyone is notified with their team and teammates.

Unplaced players (e.g. 13 players → 2 teams + 3 left) are notified and receive an **entry credit**: an admin-managed record ("1 free entry") applied to a future registration. No money moves in-platform.

*Builder's call:* the exact team-forming algorithm; whether auto-formed teams persist after the tournament (proposed: tournament-only by default, members can choose to keep the team).

### 5.6 Check-in

- Opens **1 hour before start**, closes at a configured deadline before round 1 (placeholder: 10 minutes before).
- Each player checks in individually. Checked-in subs count toward the 5.
- If fewer than 5 are checked in at the deadline, the **captain chooses**: play short-handed (**minimum 3**) or withdraw.
- Fewer than 3 checked in → **automatic forfeit**; their first opponent advances by walkover.
- Captain receives a reminder 15 minutes before the deadline if anyone is missing *(my call)*.
- After check-in closes the bracket is locked and seeded; byes are placed automatically.

### 5.7 Brackets and matches

- Formats: **double elimination** (default) and **single elimination**. Use the `brackets-manager` library for structure/seeding/advancement; render our own bracket UI (Winners / Losers / Grand Final views, round columns with best-of, match cards with seeds, scores, byes).
- Finals *(my call, per-template settings)*: double elimination defaults to a **grand final bracket reset** (the winners-bracket team must lose twice); 3rd place = loser of the losers' final. Single elimination defaults to a **3rd-place match**.
- Seeding: *builder's call* (proposed default: by team average effective rank).
- **Match flow (fallback mode):**
  1. Match opens → a moderator creates the custom lobby in the client and posts name/password in the match chat.
  2. Teams play. If streamed, it's embedded on the tournament page.
  3. **Both captains report** the winner (+ end-of-game screenshot; optional Riot match ID).
  4. **A moderator confirms every result.** Bracket updates live; next match opens.
  5. Disagreement or any problem → match is marked **disputed** until a moderator resolves it in match chat.
- If a match ID is provided (or once auto-results are available), pull match details from Riot match data for the match detail page: picks/bans, KDA, duration, VOD link.
- Moderators can override results, swap players, reset matches; every change goes to an **audit log**.
- Each round has a target start time; late matches show "delayed".

### 5.8 Tournament page (stage-aware) — the key screen

One URL per tournament for its whole life. The top section changes with state; Teams, Bracket, Rules, Schedule remain accessible below in every state.

- **Before (registration open/closed, check-in):** the landing page for ads and shared links. Hero: status tags (LAS, rank limit), title, date/format, **countdown**, primary actions **Register team** and **Find a team (free agent)**. **Prize pool meter**: current vs goal, split, and the shrink-to-pool warning. Schedule, entry fee + how to pay, and a personal **"Your status" checklist** for signed-in players (Riot linked ✓, team 5/5 ✓, payment 3/5 ⏳, check-in …). During check-in, the check-in action is primary.
- **During (live):** embedded **Twitch stream + Twitch chat** take over the top (featured match), with the **live bracket** right below. Signed-in participants see their team panel: next match, lobby info / tournament code, link to match chat with a moderator.
- **After (finished):** champion banner (team, prize won, top 3), final bracket with clickable matches → match detail, VOD list, and a prominent **"Next cup →"** link to the next edition.

All of our own matches are intended to be streamed; at minimum the featured match is embedded. *(Multiple simultaneous streams: builder's call — e.g. a stream selector.)*

Layout direction was chosen from mockups (option "stage-aware"); mockups were wireframes only — **the visual design is still to be created** (§6).

### 5.9 Profiles

- **Player profile:** Riot ID, current rank, tracked peak this season, current team(s), tournament history with placements.
- **Team profile:** name/logo, roster, tournament history.
- Public and indexable (SEO).

### 5.10 Riot integration modes

| Capability | Fallback (now) | Riot-approved |
|---|---|---|
| Sign-in | Discord/email + icon-change verification | Riot Sign On |
| Lobby | Moderator creates custom lobby, posts in match chat | Tournament API tournament codes per match |
| Results | Captains report + moderator confirms | Tournament API callback pre-fills the result; moderator still confirms |
| Match stats | From optional match ID via match data API | Automatic |
| Rank | Periodic polling of league data (needs at least a personal/production key) | Same |

The switch is per capability (config/feature flags), not a rewrite.

### 5.11 Admin and recurring templates

- **Recurring templates:** format, eligibility rules, rank source, entry fee, prize split, team cap, roster size, best-of settings, rules text, stream channel, and a schedule (e.g. "every Saturday 18:00 ART", registration opens N days before). The platform **auto-creates each next edition** (incrementing edition number, e.g. "Copa Semanal LAS #13") and opens registration so a new cup is always open. Editing one edition doesn't change the template.
- Admin tools: create/edit tournaments; mark payments per player/team; manage entry credits; rank overrides; eligibility exceptions; force-add/remove teams; run check-in and bracket; moderator assignment.
- **Moderator console:** queue of matches needing action (lobby to create, results to confirm, disputes), with match chats.

### 5.12 Notifications

In-app notifications plus email for key moments: team invite / join request, payment confirmed, auto-placement result / entry credit, check-in opening, check-in reminder, your match is ready, result confirmed, dispute update. WhatsApp/Discord later.

## 6. How it's built (decided)

| Layer | Choice |
|---|---|
| Language | TypeScript end to end |
| Runtime | Bun |
| App framework | TanStack Start (Vite, React 19, SSR) — server-rendered pages for SEO and social link previews |
| API | Hono, mounted in the same app, for Riot callbacks, admin endpoints, webhooks |
| Realtime | WebSockets on Bun (live bracket, check-in status, match chat, notifications) |
| Database | PostgreSQL + Drizzle ORM |
| Auth | Better Auth (Discord + email now; RSO as a custom OAuth provider later) |
| Jobs/scheduling | pg-boss (template edition creation, registration close + auto-placement, check-in open/close, rank polling) |
| UI | Tailwind v4 + shadcn/ui as a base, heavily customized |
| Bracket logic | brackets-manager; custom-rendered bracket UI |
| Streams/chat | Twitch embed (player + chat) |
| Validation | Zod, shared client/server |
| Hosting | São Paulo region (VPS or Fly.io), managed Postgres (Neon or Fly) |
| i18n | Spanish (es-AR) only at launch, all strings through an i18n layer |

**Visual design requirement:** use the `impeccable` skill during frontend development. Define a distinctive identity (typography, color, layout language) before building screens. No generic card grids or purple gradients.

**Performance/SEO requirements:** server-rendered public pages (home, browse, tournament, bracket, profiles, teams) with proper titles, descriptions, Open Graph images (per-tournament share image is a strong win for Instagram/WhatsApp sharing), sitemap, structured data for events (schema.org `Event`). Fast first load on mobile over Argentine networks.

## 7. Left to the builder

- Data model details, API shape, folder structure, testing approach.
- Browse-page filters beyond date/format/rank.
- Team-forming algorithm for auto-placement; seeding method; team waitlist behavior.
- Rank polling frequency (within Riot rate limits).
- Multi-stream handling on the live page.
- Moderator console layout; admin UI details.
- Exact check-in deadline default and reminder timings (placeholders given).

## Appendix A — Battlefy findings (inspected 2026-10-21)

- **Browse:** game picker → region / format / type filters; Today / This week / This weekend / custom date range; tournament cards with banner, date, countdown, organizer.
- **Tournament page tabs:** Overview, Participants, Brackets, Media, Stats, Announcements. Overview tiles: game, date/time, format (5v5; "pre-made team & free agent registrations allowed"), map & draft mode, region lock, organizer (follow / contact). Sub-tabs: Details, Rules, Prizes, Schedule, Contact.
- **Sidebar:** registration open/closed, "N/32 teams registered (M pending)", free agents registered, step-by-step join flow (create account → register team).
- **Participants:** team cards with captain and roster avatars; filters Registered / Pending / Free Agents; search.
- **Bracket:** Winners stage / Losers stage / Grand final tabs; round columns with best-of; match cards (W1, W2…) with seeds, scores, byes; Bracket / Stats / Standings views; search, hide-spoilers, fullscreen.
- **Recurring pattern:** organizers run weekly series as separate tournaments, including a "[Main Event]" plus a "[Second Chance]" event per week.
