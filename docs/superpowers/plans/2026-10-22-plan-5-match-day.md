# Plan 5: Match Day — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take a closed tournament through check-in, a seeded bracket, match-by-match play (lobby, captain reports, moderator confirmation, disputes, chat) and finish, with a moderator console that shows what needs action.

**Architecture:** `brackets-manager` runs over an `InMemoryDatabase` that is imported from and exported to one jsonb row per tournament (`brackets.data`), always inside a transaction holding the tournament lock, so the library never needs a Postgres storage adapter. Our own `matches` table mirrors each playable bracket match (teams, lobby, state, scores) and is rewritten from the library's data after every bracket mutation, so the bracket library owns advancement and our tables own the match-day workflow. WebSockets are push-only (a small `ws` server fed by an in-process hub); every write goes through ordinary server functions that publish after commit.

**Tech Stack:** Existing stack plus `brackets-manager@1.11.1`, `brackets-memory-db@1.0.6`, `brackets-model@1.7.0` and `ws`. pg-boss drives the two time-based transitions.

**Spec:** `docs/superpowers/specs/2026-10-21-gorosei-mvp-design.md` §5.6, §5.7, §5.10 (fallback mode), §5.11 (moderator console), §4 (moderator powers). **Roadmap:** `docs/superpowers/plans/2026-10-21-gorosei-roadmap.md`. **Design system:** `DESIGN.md`, `PRODUCT.md`. **Builds on:** Plans 3 and 4 (completed).

## Global Constraints

- Check-in **opens 1 hour before start**, **closes 10 minutes before start** (placeholder from the spec; one constant each in `src/shared/check-in.ts`). Each player checks in individually; checked-in subs count toward the 5.
- Fewer than 5 checked in at the deadline: the **captain chooses** to play short-handed (**minimum 3**) or withdraw. **Fewer than 3 → automatic forfeit**; the first opponent advances by walkover. A forfeiting or withdrawing team gets **no refund or credit** (payments marked `forfeited`, as in Plan 3).
- **After check-in closes the bracket is locked and seeded; byes are placed automatically.** Rosters lock when check-in opens (Plan 3 already refuses roster edits outside registration); afterwards only moderators swap players, re-validated against the stored snapshots.
- Formats: **double elimination** (default, **grand final with bracket reset**; 3rd place = loser of the losers' final) and **single elimination** (**3rd-place match**), both through `brackets-manager`. Best-of is `bestOf` for every match except finals (`finalsBestOf`: the single-elimination final and both double-elimination grand-final matches).
- Seeding: by **team average effective rank** (the registration snapshots), best team first; ties by registration time.
- Match flow (fallback mode): a moderator creates the lobby in the client and posts name/password; **both captains report** the winner with an end-of-game screenshot link and optional Riot match ID(s); **a moderator confirms every result**; disagreement → `disputed` until a moderator resolves it. A confirmed result updates the bracket live and opens the next match.
- Moderators (and admins) can override a result, forfeit a team, reset a match and swap players; **every change is audited** (`writeAudit` in the same transaction).
- If match IDs are provided, pull details from Riot match data (picks/bans, KDA, duration) for the match page. LAS match IDs look like `LA2_123456`.
- Realtime is WebSockets; the page must still work after a plain reload without it.
- Every user-facing string goes through `t()` (es-AR, "vos"). Store UTC, display `America/Argentina/Buenos_Aires`. Domain functions never throw for expected failures; they return a typed reason with an i18n message (`matchday.error.<reason>`).
- UI follows `DESIGN.md`: signal red only for the status tag and the one primary action per screen; Impeccable bans apply (no card grids, gradient text, glassmorphism, side-stripe borders, eyebrow above every section, radius > 16px). The moderator console is a dense work queue, not a dashboard of tiles.

## Review Focus

1. **Odd and tiny fields at check-in close** — 0, 1, 2, 3, 5 and 8 surviving teams: 0 or 1 → tournament cancelled with credits and no bracket; otherwise a bracket with byes, never a crash. → Task 4.
2. **Check-in edge counts** — exactly 5, 4, 3 and 2 checked in; captain never decides; a player checks in twice or from another team; check-in outside the window. → Tasks 3 and 4.
3. **Conflicting or missing reports** — captains report different scores (disputed), only one captain reports (stays in progress, moderator can still confirm with an explicit result), a captain edits a report after a dispute (re-evaluated), reporting after confirmation. → Task 5.
4. **Impossible scores and outsiders** — 3–3 or 2–0 in a Bo1, a non-captain, a captain of another team, a non-participant posting chat or subscribing to a match channel. → Tasks 5, 7 and 8.
5. **Bracket edge rules** — grand final won by the winners-bracket team ends the tournament without a reset match; won by the losers-bracket team opens the reset; two moderators confirming the same match at once; resetting a match whose next match was already played is refused. → Task 6.

## Builder's calls (made here, not confirmed by the owner)

- **A captain who never decides** is treated as "play short-handed" when ≥3 are checked in (forfeiting hurts the opponent more than playing a man down); the captain can choose "withdraw" any time while check-in is open.
- **Teams that fail check-in are left out of the seeding** instead of being seeded and walked over; their would-be opponents get a bye, which is the same outcome. Their registration becomes `forfeited`.
- **Fewer than 2 teams left at check-in close cancels the tournament** (`cancelTournament`, so everyone with a live payment gets a credit).
- **Delayed** has no round schedule to compare against: a match is delayed when it has been open longer than `expectedMatchMinutes(bestOf)` (45 / 75 / 105 for Bo1 / Bo3 / Bo5) plus 15 minutes with no confirmed result.
- **Screenshots are links** (https URL to an image host), not uploads; there is no file storage yet.
- **No waitlist promotion after close**, no check-in reminders (Plan 7 notifications), no moderator-assignment UI (roles are set in the database for now).
- **Realtime** is a `ws` server on `REALTIME_PORT` (default 3001) reached through a same-origin `/realtime` proxy rule (Vite dev proxy now; the reverse proxy in production), so session cookies authenticate the upgrade. Events carry no private data except chat messages, and the server re-checks access per channel.
- **Public bracket and results pages** are Plan 6; this plan's pages are the match page, the check-in panel and the moderator console.

---

## File Structure

```
src/shared/check-in.ts                CHECK_IN_* constants, checkInWindow, checkInOutcome
src/shared/seeding.ts                 seedOrder (pure)
src/shared/match.ts                   MATCH_STATUSES, reportInputSchema, validateScore, bestOfFor, expectedMatchMinutes, isDelayed
src/server/db/schema/matchday.ts      check_ins, brackets, matches, match_reports, match_messages (+ registrations.check_in_decision)
src/server/bracket/engine.ts          createBracket, applyResult, resetMatchResult, bracketComplete, finalStandings (pure over BracketData)
src/server/bracket/bracket.ts         startBracket, syncMatches, getMatchView, listMatches
src/server/matchday/check-in.ts       checkIn, decideShortHanded, getCheckInView, openCheckIn, closeCheckIn
src/server/matchday/reports.ts        postLobby, reportResult
src/server/matchday/moderation.ts     confirmMatch, forfeitMatch, resetMatch, swapPlayer, getConsoleQueue
src/server/matchday/chat.ts           postMessage, listMessages, canAccessMatchChat
src/server/matchday/stats.ts          attachRiotMatchIds
src/server/realtime/hub.ts, server.ts publish/subscribe hub; ws server
src/server/jobs/advance-tournaments.ts   opens and closes check-in
src/server/riot/{types,client}.ts     + getMatch
src/server/matchday/*.functions.ts    server functions
src/routes/partidas.$matchId.tsx, src/routes/mod.tsx, src/components/matchday/*, check-in panel on torneos.$slug.tsx
tests/shared/{check-in,seeding,match}.test.ts, tests/server/bracket/*.test.ts, tests/server/matchday/*.test.ts, tests/server/realtime/*.test.ts
e2e/match-day.spec.ts
```

---

### Task 1: Pure rules — check-in, seeding, match

**Files:**
- Create: `src/shared/check-in.ts`, `src/shared/seeding.ts`, `src/shared/match.ts`
- Modify: `src/shared/tournament.ts` (`registrationClosesAt` must be ≤ `startsAt` − 1 hour, message key `tournament.error.registrationTooLate`), `src/shared/i18n/es-AR.ts`
- Test: `tests/shared/check-in.test.ts`, `tests/shared/seeding.test.ts`, `tests/shared/match.test.ts`, `tests/shared/tournament.test.ts`

**Interfaces:**
- Consumes: `Rank`, `rankValue` (`rank.ts`).
- Produces:
  ```ts
  // check-in.ts
  const CHECK_IN_OPENS_BEFORE_MINUTES = 60;  const CHECK_IN_CLOSES_BEFORE_MINUTES = 10;  const MIN_SHORT_HANDED = 3;
  checkInWindow(startsAt: Date): { opensAt: Date; closesAt: Date };
  type ShortHandedDecision = "play" | "withdraw";
  type CheckInOutcome = "in" | "short_handed" | "withdrawn" | "forfeit";
  checkInOutcome(checkedIn: number, decision: ShortHandedDecision | null): CheckInOutcome;
  // seeding.ts
  seedOrder<T extends { id: string; ranks: (Rank | null)[]; registeredAt: Date }>(teams: T[]): T[];  // best average rank first
  // match.ts
  const MATCH_STATUSES = ["waiting", "open", "in_progress", "reported", "disputed", "completed"] as const;  type MatchStatus
  reportInputSchema: z.ZodType<{ own: number; opponent: number; screenshotUrl: string | null; riotMatchIds: string[] }>;
  validateScore(bestOf: 1 | 3 | 5, a: number, b: number): boolean;  // exactly one side reaches ceil(bestOf/2), the other is below it
  bestOfFor(t: { bestOf: 1|3|5; finalsBestOf: 1|3|5 }, phase: MatchPhase): 1 | 3 | 5;
  type MatchPhase = "winners" | "losers" | "grand_final" | "reset" | "main" | "final" | "third_place";
  expectedMatchMinutes(bestOf: 1|3|5): number;  isDelayed(openedAt: Date | null, bestOf: 1|3|5, now: Date): boolean;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `check-in.test.ts`: `checkInWindow` for a 20:00Z start returns 19:00Z / 19:50Z. `checkInOutcome(5, null) = "in"`, `(7, null) = "in"`, `(4, null) = "short_handed"`, `(4, "play") = "short_handed"`, `(4, "withdraw") = "withdrawn"`, `(3, null) = "short_handed"`, `(2, "play") = "forfeit"`, `(0, null) = "forfeit"`, `(5, "withdraw") = "in"` (a full lineup ignores a stale decision).
  - `seeding.test.ts`: `seedOrder` puts the higher average first; a `null` rank counts as the lowest tier; equal averages order by `registeredAt`; an empty rank list sorts last; input is not mutated.
  - `match.test.ts`: `validateScore(1,1,0)` ok, `(1,1,1)`, `(1,0,0)` and `(1,2,0)` rejected; `(3,2,1)` ok, `(3,3,0)` rejected, `(3,2,2)` rejected; `(5,3,2)` ok. `reportInputSchema` rejects a non-https screenshot URL and more than 3 Riot IDs and any ID not matching `^LA2_\d+$`, accepts `null` screenshot. `bestOfFor` returns `finalsBestOf` for `grand_final`, `reset`, `final`, `bestOf` for the rest. `isDelayed` false before `expectedMatchMinutes + 15`, true after, false when `openedAt` is null.
  - `tournament.test.ts`: input with `registrationClosesAt` 30 minutes before `startsAt` is rejected; 60 minutes before is accepted.
- [ ] **Step 2:** Run `bun test tests/shared` → FAIL.
- [ ] **Step 3: Implement** the signatures above. `seedOrder` sorts by `rankValue` average of non-empty rank lists, nulls counting as 0.
- [ ] **Step 4:** Run `bun test tests/shared` → PASS (existing form/e2e fixtures that close registration later than an hour before start get fixed in this step).
- [ ] **Step 5: Commit** `feat: add check-in, seeding and match rules`

### Task 2: Bracket engine over brackets-manager

**Files:**
- Create: `src/server/bracket/engine.ts`
- Modify: `package.json` / `bun.lock` (`bun add brackets-manager@1.11.1 brackets-memory-db@1.0.6 brackets-model@1.7.0`)
- Test: `tests/server/bracket/engine.test.ts`

**Interfaces:**
- Consumes: nothing from the app. Participant names are registration ids.
- Produces:
  ```ts
  import type { Database } from "brackets-model";
  type BracketData = Database;
  type EngineMatch = { id: number; group: number; round: number; number: number; phase: MatchPhase;
    status: "locked" | "waiting" | "ready" | "running" | "completed" | "archived";
    team1: string | null; team2: string | null; score1: number | null; score2: number | null; winner: string | null };
  createBracket(type: "double_elimination" | "single_elimination", seeds: string[]): Promise<{ data: BracketData; stageId: number }>;
    // DE: grandFinal "double"; SE: consolationFinal true; seedOrdering inner_outer; balanceByes true
  listEngineMatches(data: BracketData): EngineMatch[];  // phase derived from group/round (see below)
  applyResult(data: BracketData, matchId: number, result: { score1: number; score2: number } | { forfeit: 1 | 2 }): Promise<BracketData>;
  resetMatchResult(data: BracketData, matchId: number): Promise<BracketData>;  // throws EngineError("next_match_started") when the library refuses
  bracketComplete(data: BracketData): boolean;  // every match completed or archived
  finalStandings(data: BracketData, stageId: number): Promise<{ registrationId: string; rank: number }[]>;
  ```

- [ ] **Step 1: Write the failing tests** (seeds are strings `"r1"…`):
  - `creates a double-elimination bracket for 8 teams` → 14 playable-or-pending matches plus grand final and reset; the first round pairs seed 1 vs 8 and every phase is classified (`winners`, `losers`, `grand_final`, `reset`).
  - `creates a single-elimination bracket with a third-place match` for 4 teams: 4 matches, phases `main`×2, `final`, `third_place`.
  - `5 teams get byes` (SE and DE): the bye matches are `archived`, nobody is paired with null in a `ready` match, and the number of `ready` first-round matches is 1.
  - `applyResult advances the winner`: after reporting match 1, the winner is `team1`/`team2` of the next match; `{ forfeit: 2 }` advances team 1 (walkover).
  - `a winners-final team that wins grand final 1 completes the bracket` (reset match archived, `bracketComplete` true); `when the losers-side team wins, the reset match becomes ready` and the bracket completes only after it. Pin the exact library statuses seen in this test as the definition of `archived`.
  - `resetMatchResult` undoes a result when the next match has not started and throws `EngineError("next_match_started")` when it has.
  - `finalStandings` returns 1st, 2nd and 3rd for a finished 4-team SE bracket.
- [ ] **Step 2:** Run `bun test tests/server/bracket/engine.test.ts` → FAIL.
- [ ] **Step 3: Implement** with `new BracketsManager(new InMemoryDatabase())`, `manager.import(data, false)` before and `manager.export()` after each operation; the manager is never kept between calls. Phase mapping: DE group 1 winners, 2 losers, 3 grand final (round 1) and reset (round 2); SE group 1 main with the last round `final`, group 2 `third_place`. `EngineError` is a small class with a `code` field.
- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5: Commit** `feat: add bracket engine over brackets-manager`

### Task 3: Match-day schema, bracket persistence and check-in

**Files:**
- Create: `src/server/db/schema/matchday.ts`, `src/server/bracket/bracket.ts`, `src/server/matchday/check-in.ts`
- Modify: `src/server/db/schema/index.ts`, `src/server/db/schema/competition.ts` (`registrations.check_in_decision text null`), `src/shared/tournament.ts` (`REGISTRATION_STATUSES` gains `"forfeited"`), `src/server/tournaments/registrations.ts` and `src/server/tournaments/confirmations.ts` (exhaustive status maps), `tests/helpers/competition.ts`, `src/shared/i18n/es-AR.ts`, migration via `bun run db:generate`
- Test: `tests/server/matchday/check-in.test.ts`

**Interfaces:**
- Consumes: Task 1 (`checkInWindow`, `ShortHandedDecision`), `lockTournament`, `writeAudit`.
- Produces:
  ```ts
  // schema/matchday.ts (all timestamps timestamptz)
  check_ins:       registration_id, user_id (PK together), tournament_id, checked_in_at, by_user_id text null  // set when a moderator checks someone in
  brackets:        tournament_id PK, data jsonb BracketData, stage_id int, final_standings jsonb null, updated_at
  matches:         id uuid PK, tournament_id, bm_match_id int (unique with tournament_id), phase MatchPhase, group_no int, round_no int, number int,
                   best_of int, reg1_id uuid null, reg2_id uuid null, status MatchStatus, lobby_name text null, lobby_password text null,
                   lobby_posted_by text null, opened_at tz null, score1 int null, score2 int null, winner_reg_id uuid null,
                   confirmed_by text null, confirmed_at tz null, riot_match_ids jsonb string[], stats jsonb null
  match_reports:   match_id, registration_id (PK together), score1 int, score2 int, screenshot_url text null, riot_match_ids jsonb, created_at, updated_at
  match_messages:  id uuid PK, match_id, author_user_id text null, kind "message" | "system" | "lobby", body text, created_at
  // check-in.ts
  type CheckInRejection = "not_open" | "not_on_roster" | "registration_inactive" | "not_captain" | "invalid_state";
  checkIn(db: Db, userId: string, registrationId: string, now: Date): Promise<{ ok: true } | { ok: false; reason: CheckInRejection }>;  // idempotent
  decideShortHanded(db: Db, captainId: string, registrationId: string, decision: ShortHandedDecision, now: Date): Promise<{ ok: true } | { ok: false; reason: CheckInRejection }>;
  type CheckInView = { registrationId: string; windowOpensAt: Date; windowClosesAt: Date; open: boolean;
    players: { userId: string; riotId: string; isSub: boolean; checkedIn: boolean }[]; checkedInCount: number; decision: ShortHandedDecision | null; outcome: CheckInOutcome };
  getCheckInView(db: Db, registrationId: string, now: Date): Promise<CheckInView | null>;
  ```
  `checkIn` is open only while the tournament is `check_in` and `now` is inside the window; only a player on the active roster of a `confirmed` registration may check in; a moderator-initiated check-in is part of `swapPlayer` (Task 6).

- [ ] **Step 1: Write the failing tests** (`check-in.test.ts`, tournament fixture in `check_in` status with one confirmed 5-player team + 1 sub):
  - `a rostered player checks in; checking in twice is a no-op`; `a sub counts toward checkedInCount`.
  - `rejects a player who is not on the roster` → `not_on_roster`; `rejects before the tournament is in check_in` and `after the window closes` → `not_open`; `rejects a withdrawn or forfeited registration` → `registration_inactive`.
  - `only the captain decides` → `not_captain`; `decision is stored and can be changed while open`; `getCheckInView.outcome` follows `checkInOutcome` for 5/4/2 checked in.
- [ ] **Step 2:** Run `bun test tests/server/matchday/check-in.test.ts` → FAIL.
- [ ] **Step 3: Implement** the schema (one migration), the `forfeited` status wherever `Record<RegistrationStatus, …>` or status lists exist (a forfeited registration is inactive for roster edits like `withdrawn`), `checkIn`, `decideShortHanded`, `getCheckInView`. Audit `checkin.checked_in` and `checkin.decision`. Add `matchday.error.<reason>` strings.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add match-day schema and check-in`

### Task 4: Opening and closing check-in, bracket start, cancel on empty field

**Files:**
- Create: `src/server/jobs/advance-tournaments.ts`
- Modify: `src/server/matchday/check-in.ts` (`openCheckIn`, `closeCheckIn`), `src/server/bracket/bracket.ts` (`startBracket`, `syncMatches`), `src/server/tournaments/credits.ts` (`cancelTournament` accepts `adminId: string | null`), `src/server/jobs/boss.ts`, `src/server/tournaments/admin.functions.ts` (`openCheckInFn`, `closeCheckInFn`)
- Test: `tests/server/matchday/close-check-in.test.ts`, `tests/server/jobs/advance-tournaments.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3, `createBracket`, `listEngineMatches`, `seedOrder`, `cancelTournament`, forfeit handling of `entry_payments` as in `withdrawRegistration`.
- Produces:
  ```ts
  openCheckIn(db: Db, tournamentId: string, now: Date, actorUserId: string | null, opts?: { force?: boolean }):
    Promise<{ ok: true } | { ok: false; reason: "invalid_state" | "too_early" }>;  // registration_closed → check_in; force skips the time check (admin only)
  closeCheckIn(db: Db, tournamentId: string, now: Date, actorUserId: string | null, opts?: { force?: boolean }):
    Promise<{ ok: true; outcome: "live" | "cancelled"; forfeited: number; teams: number } | { ok: false; reason: "invalid_state" | "too_early" }>;
  // bracket.ts
  startBracket(tx: Executor, tournament: Tournament, registrationIds: string[]): Promise<void>;  // seeds with seedOrder from snapshots, stores brackets row, calls syncMatches
  syncMatches(tx: Executor, tournamentId: string, now: Date): Promise<void>;  // rewrites matches from brackets.data: upsert by bm_match_id, skips archived matches, sets status/teams/scores/winner/opened_at
  advanceTournaments(db: Db, now: Date): Promise<{ opened: number; closed: number }>;  // job body
  ```
  `closeCheckIn` per confirmed registration: count `check_ins`, apply `checkInOutcome`; `forfeit`/`withdrawn` → registration `forfeited`, players inactive, payments forfeited, audit `registration.forfeited` with the reason; survivors are seeded. Fewer than 2 survivors → `cancelTournament` (reason "no_field") and no bracket; otherwise status `live`. Open matches get `opened_at = now`. The job runs every minute like `close-registrations`.

- [ ] **Step 1: Write the failing tests** (helper `confirmedTeam(tournament, checkedInCount, decision?)` builds a confirmed paid team and checks that many players in):
  - `openCheckIn waits until one hour before start` (`too_early`), moves `registration_closed` → `check_in`, rejects other states, and `force` skips the time check; roster edits are refused afterwards (`locked`).
  - Review Focus 1: `closeCheckIn with 8 full teams` → `live`, 4 round-1 `open` matches, seeds 1v8; `5 teams` → byes placed, exactly 1 `open` match and the byes' teams `waiting` in round 2; `3 teams` works; `1 survivor` and `0 survivors` → tournament `cancelled`, no `brackets` row, live payments of the survivor credited, forfeited teams' payments not credited.
  - Review Focus 2: `4 checked in, no decision` plays short-handed; `4 checked in, withdraw` → `forfeited` with payments `forfeited`; `3 checked in` plays; `2 checked in` → `forfeited` and the opponent is not seeded against them; `a team with only unchecked players` forfeits.
  - `closeCheckIn is idempotent`: a second call returns `invalid_state` and changes nothing; `before the deadline` → `too_early`; `audit` has `tournament.live` and one `registration.forfeited` per forfeit.
  - `advanceTournaments` opens a due tournament and closes a due check-in in one call and leaves not-yet-due tournaments alone.
- [ ] **Step 2:** Run `bun test tests/server/matchday tests/server/jobs` → FAIL.
- [ ] **Step 3: Implement** the signatures above. `closeCheckIn` runs entirely in one transaction under `lockTournament`; schedule `advance-tournaments` in `boss.ts` next to the other jobs.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: open and close check-in and start the bracket`

### Task 5: Lobby and captain reports

**Files:**
- Create: `src/server/matchday/reports.ts`
- Modify: `src/server/bracket/bracket.ts` (`getMatchView`, `listMatches`), `src/shared/i18n/es-AR.ts`
- Test: `tests/server/matchday/reports.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4 (`matches`, `match_reports`, `validateScore`, `bestOfFor`).
- Produces:
  ```ts
  type ReportRejection = "not_found" | "not_participant" | "not_captain" | "not_open" | "already_confirmed" | "invalid_score" | "lobby_exists";
  postLobby(db: Db, moderatorId: string, matchId: string, lobby: { name: string; password: string }):
    Promise<{ ok: true } | { ok: false; reason: ReportRejection }>;
    // match must be open; status → in_progress; adds a "lobby" chat message (name only, password stays in the lobby columns); audit
  reportResult(db: Db, captainId: string, matchId: string, input: ReportInput):
    Promise<{ ok: true; status: "in_progress" | "reported" | "disputed" } | { ok: false; reason: ReportRejection }>;
    // captain of reg1 or reg2; upserts that team's report (own/opponent → score1/score2); both present and equal → reported, different → disputed
  type MatchView = { id: string; tournamentId: string; phase: MatchPhase; round: number; number: number; bestOf: 1|3|5; status: MatchStatus; delayed: boolean;
    teams: [MatchTeam | null, MatchTeam | null]; score: [number | null, number | null]; winnerRegistrationId: string | null;
    reports: { registrationId: string; score1: number; score2: number; screenshotUrl: string | null }[];
    lobby: { name: string; password: string } | null; riotMatchIds: string[]; stats: unknown | null };
  getMatchView(db: Db, matchId: string, viewer: { userId: string; role: Role } | null, now: Date): Promise<MatchView | null>;
    // lobby and reports are returned only to participants of either team and moderators/admins
  ```

- [ ] **Step 1: Write the failing tests** (two-team tournament already `live`, one `open` match):
  - `postLobby` stores the lobby, moves to `in_progress`, adds a chat line, and a second post → `lobby_exists`; a match that is `waiting` → `not_open`.
  - `reportResult` from team 1 only → `in_progress` with one report; the second team reporting the same score → `reported`; Review Focus 3: a different score → `disputed`; team 2 editing its report to match → back to `reported`; a report after `completed` → `already_confirmed`.
  - Review Focus 4: `own: 3, opponent: 3` in a Bo3 and `own: 2, opponent: 0` in a Bo1 → `invalid_score`; a non-captain player → `not_captain`; a captain of another team → `not_participant`; an invalid Riot ID is refused by the schema.
  - `finals use finalsBestOf` (a Bo3 grand final accepts 2–1).
  - `getMatchView hides lobby and reports from outsiders` and shows them to a captain, a moderator and an admin; `delayed` is true for a match open past the expected time.
- [ ] **Step 2:** Run `bun test tests/server/matchday/reports.test.ts` → FAIL.
- [ ] **Step 3: Implement** the signatures above. Each mutation locks the match row `FOR UPDATE`, audits `match.lobby_posted` / `match.reported`, and publishes `match:<id>` and `tournament:<tournamentId>` events through the hub after commit (hub is a no-op until Task 7).
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add lobby posting and captain result reports`

### Task 6: Moderator actions — confirm, override, forfeit, reset, swap, finish

**Files:**
- Create: `src/server/matchday/moderation.ts`
- Modify: `src/server/bracket/bracket.ts` (store `final_standings`), `src/shared/i18n/es-AR.ts`
- Test: `tests/server/matchday/moderation.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5 (`applyResult`, `resetMatchResult`, `bracketComplete`, `finalStandings`, `syncMatches`), `takePlayerSnapshot`, `evaluateRegistration`, `exemptRuleIdsFor`.
- Produces:
  ```ts
  type ModRejection = "not_found" | "invalid_state" | "no_result" | "invalid_score" | "already_completed" | "next_match_started" | "not_member" | "ineligible" | "player_already_registered" | "riot_required";
  confirmMatch(db: Db, moderatorId: string, matchId: string, result?: { score1: number; score2: number }): Promise<{ ok: true; finished: boolean } | { ok: false; reason: ModRejection }>;
    // without result: uses the two reports when they agree, or the single report; no report and no result → no_result. With result: override (also resolves a dispute)
  forfeitMatch(db: Db, moderatorId: string, matchId: string, forfeitingRegistrationId: string): Promise<{ ok: true; finished: boolean } | { ok: false; reason: ModRejection }>;
  resetMatch(db: Db, moderatorId: string, matchId: string): Promise<{ ok: true } | { ok: false; reason: ModRejection }>;  // clears reports and result, status back to open
  swapPlayer(deps: RegistrationDeps, moderatorId: string, registrationId: string, outUserId: string, inUserId: string):
    Promise<{ ok: true } | { ok: false; reason: ModRejection; failures?: EligibilityFailure[] }>;
    // in-player must be a team member, takes a fresh snapshot, roster re-validated with the stored snapshots; marks the new player checked in (by_user_id = moderator)
  ```
  A confirmed result that completes the bracket sets the tournament `finished`, stores placements in `brackets.final_standings`, and audits `tournament.finished`. All four mutations lock tournament then match, in that order.

- [ ] **Step 1: Write the failing tests:**
  - `confirmMatch uses agreeing reports`, `confirms with a single report`, `refuses with no report and no result` (`no_result`), `an override resolves a disputed match`, and `the winner appears in the next match` (second-round row has the team and `open`).
  - `confirmMatch twice` → `already_completed`; Review Focus 5: two concurrent `confirmMatch` calls via `Promise.all` leave exactly one success and one `already_completed`.
  - Review Focus 5: `grand final won by the winners-bracket team finishes the tournament` (no reset match in `matches`, status `finished`, standings stored); `won by the losers-bracket team opens the reset and finishes only after it`.
  - `forfeitMatch` advances the opponent with a walkover and audits `match.forfeited`; `resetMatch` reopens a match whose next match has not started and clears its reports; `resetMatch` on a match whose next match was already played → `next_match_started` and nothing changes.
  - `swapPlayer` replaces a starter, marks the new player checked in by the moderator, refuses someone who is not a team member (`not_member`) or already on another roster, and refuses a swap that breaks the tournament's rules, returning the failures and leaving the roster intact.
  - Every action writes one audit row with the moderator as actor.
- [ ] **Step 2:** Run `bun test tests/server/matchday/moderation.test.ts` → FAIL.
- [ ] **Step 3: Implement** the signatures above. Reports are deleted on reset after being copied into the audit `data`.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add moderator confirm, override, forfeit, reset and swap`

### Task 7: Realtime hub and WebSocket server

**Files:**
- Create: `src/server/realtime/hub.ts`, `src/server/realtime/server.ts`
- Modify: `package.json` (`bun add ws`, `bun add -d @types/ws`), `src/server/env.ts` (`REALTIME_PORT`, optional, default 3001), `.env.example`, `src/server.ts` (start the server beside `startJobs`, never under `NODE_ENV=test`), `vite.config.ts` (`/realtime` proxy with `ws: true`), `src/server/matchday/*.ts` (publish calls)
- Test: `tests/server/realtime/hub.test.ts`, `tests/server/realtime/server.test.ts`

**Interfaces:**
- Consumes: `getSessionUser`.
- Produces:
  ```ts
  // hub.ts — one instance on globalThis so dev reloads share it
  type RealtimeEvent = { channel: string; type: string; data?: unknown };
  publish(event: RealtimeEvent): void;
  subscribe(channel: string, listener: (event: RealtimeEvent) => void): () => void;  // returns unsubscribe
  // channels: tournament:<id> (public), match:<id> (public state, no private data), chat:<matchId> (participants + moderators), console (moderators)
  // server.ts
  type ChannelAccess = (user: SessionUser | null, channel: string) => Promise<boolean>;
  startRealtimeServer(opts: { port: number; authenticate: (headers: Headers) => Promise<SessionUser | null>; canSubscribe: ChannelAccess }): { close(): Promise<void>; port: number };
  // protocol: client sends {"type":"subscribe","channel":"…"} / {"type":"unsubscribe",…}; server sends {"channel","type","data"} or {"type":"denied","channel"}
  canSubscribe(db: Db): ChannelAccess;  // in server.ts: public channels → true; chat → canAccessMatchChat (Task 8); console → moderator or admin
  ```

- [ ] **Step 1: Write the failing tests:**
  - `hub.test.ts`: a subscriber receives only its channel, unsubscribe stops delivery, a throwing listener does not stop the others.
  - `server.test.ts` (real `ws` client against `port: 0`): a public channel subscription receives published events; subscribing to a private channel without access gets `{"type":"denied"}` and never receives its events; the server survives a client sending malformed JSON; `close()` drops connections.
- [ ] **Step 2:** Run `bun test tests/server/realtime` → FAIL.
- [ ] **Step 3: Implement** with `ws`'s `WebSocketServer`; authenticate once on the upgrade from the cookie header; access is re-checked on every subscribe. Add `publish` calls after commit in Tasks 3–6 code (`tournament:<id>` on any bracket or status change, `match:<id>` on any match change, `console` when a match enters `open`, `reported` or `disputed`).
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add realtime hub and websocket server`

### Task 8: Match chat

**Files:**
- Create: `src/server/matchday/chat.ts`
- Modify: `src/shared/i18n/es-AR.ts`
- Test: `tests/server/matchday/chat.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5, hub.
- Produces:
  ```ts
  canAccessMatchChat(db: Db, user: { id: string; role: Role }, matchId: string): Promise<boolean>;  // active roster player of either team, moderator, admin
  postMessage(db: Db, user: { id: string; role: Role }, matchId: string, body: string): Promise<{ ok: true; message: ChatMessage } | { ok: false; reason: "not_found" | "forbidden" | "empty" | "too_long" | "closed" }>;
  listMessages(db: Db, user: { id: string; role: Role }, matchId: string, opts?: { before?: Date; limit?: number }): Promise<ChatMessage[] | null>;  // null when not allowed; oldest first, default limit 100
  type ChatMessage = { id: string; kind: "message" | "system" | "lobby"; authorUserId: string | null; authorRiotId: string | null; body: string; createdAt: Date };
  ```
  Body is trimmed, 1–1000 characters, stored and rendered as plain text. Chat closes (`closed`) 24 hours after the match is completed so finished matches stop collecting messages; moderators can still post.

- [ ] **Step 1: Write the failing tests:** Review Focus 4 — `a player outside both teams cannot read, post or subscribe` (`forbidden` / `null` / `canAccessMatchChat` false); a benched player of either team can; `moderators post on any match`; `empty and 1001-character bodies are refused`; `a <script> body is stored verbatim` (no escaping at write time, no HTML output anywhere); `a post publishes on chat:<matchId>` (subscribe to the hub); `listMessages returns system and lobby lines in order`; `after 24h completed` → `closed` for players, ok for a moderator.
- [ ] **Step 2:** Run `bun test tests/server/matchday/chat.test.ts` → FAIL.
- [ ] **Step 3: Implement** the signatures above; audit is not written for chat messages (the table is the record).
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add match chat`

### Task 9: Match stats from Riot match IDs

**Files:**
- Create: `src/server/matchday/stats.ts`
- Modify: `src/server/riot/types.ts`, `src/server/riot/client.ts`, `tests/helpers/fake-riot.ts`, `tests/server/riot/client.test.ts`
- Test: `tests/server/matchday/stats.test.ts`

**Interfaces:**
- Consumes: `RiotClient`, Task 5 `MatchView`.
- Produces:
  ```ts
  // types.ts
  type RiotMatch = { matchId: string; durationSeconds: number; winningTeamId: 100 | 200;
    teams: { teamId: 100 | 200; win: boolean; bans: number[] }[];
    players: { puuid: string; teamId: 100 | 200; championName: string; kills: number; deaths: number; assists: number; role: string }[] };
  RiotClient.getMatch(matchId: string): Promise<RiotResult<RiotMatch>>;  // regional host americas, /lol/match/v5/matches/{id}
  // stats.ts
  type StatsRejection = "not_found" | "forbidden" | "invalid_id" | "riot_unavailable" | "not_this_match";
  attachRiotMatchIds(deps: { db: Db; riot: RiotClient }, user: { id: string; role: Role }, matchId: string, riotMatchIds: string[]): Promise<{ ok: true } | { ok: false; reason: StatsRejection }>;
    // participants (captains) and moderators; each ID must be a LAS match with ≥3 players from each roster by puuid, else not_this_match
  ```
  Stats are stored as `matches.stats` (array of `RiotMatch` plus a `riotId` per player resolved from the stored roster) and `riot_match_ids`; fetched once per ID, never on page view.

- [ ] **Step 1: Write the failing tests:** client: `getMatch` hits the americas host with the match ID and maps the Riot payload (gameDuration, participants, bans) to `RiotMatch`; 404 → `not_found`. Stats: a match with 5 + 5 players from the two rosters is stored; an ID with players from other rosters → `not_this_match`; `LA1_123` → `invalid_id`; a Riot outage → `riot_unavailable` and nothing stored; outsiders → `forbidden`; re-attaching the same ID does not duplicate it.
- [ ] **Step 2:** Run `bun test tests/server/riot tests/server/matchday/stats.test.ts` → FAIL.
- [ ] **Step 3: Implement** the signatures above; the fake client gets `addMatch(match: RiotMatch)`. Audit `match.stats_attached`.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: pull match stats from Riot match IDs`

### Task 10: Server functions, pages and end-to-end

**Files:**
- Create: `src/server/matchday/matchday.functions.ts`, `src/routes/partidas.$matchId.tsx`, `src/routes/mod.tsx`, `src/components/matchday/{check-in-panel,match-header,report-form,lobby-box,match-chat,console-queue,use-realtime}.tsx`, `e2e/match-day.spec.ts`
- Modify: `src/routes/torneos.$slug.tsx` (check-in panel for rostered players while `check_in`; link to the player's current match while `live`), `src/routes/admin.torneos.$id.tsx` (open/close check-in buttons with `force`), `src/server/bracket/bracket.ts` (`getConsoleQueue`), `src/shared/i18n/es-AR.ts`, `e2e/helpers/tournaments.ts`
- Test: `tests/server/matchday/console-queue.test.ts`, `e2e/match-day.spec.ts`

**Interfaces:**
- Consumes: Tasks 3–9.
- Produces:
  ```ts
  type ConsoleItem = { matchId: string; tournamentSlug: string; kind: "dispute" | "confirm" | "lobby" | "delayed"; round: number; teams: [string, string]; reportCount: number; since: Date };
  getConsoleQueue(db: Db, now: Date): Promise<ConsoleItem[]>;  // live tournaments only; disputes first, then results to confirm, then lobbies to create, then delayed; oldest first within a kind
  // server functions (all re-check role on the server; moderator/admin gate returns the ordinary not-found page like requireAdmin)
  checkInFn, decideShortHandedFn, postLobbyFn, reportResultFn, confirmMatchFn, forfeitMatchFn, resetMatchFn, swapPlayerFn,
  postMessageFn, listMessagesFn, attachRiotMatchIdsFn, getMatchPage, getConsolePage, getCheckInPanel
  // use-realtime.tsx
  useRealtime(channels: string[], onEvent: (e: RealtimeEvent) => void): void;  // connects to /realtime, reconnects with backoff, resubscribes, falls back to a 15 s router.invalidate poll while disconnected
  ```
  Routes: `/partidas/$matchId` (participants and moderators; others get the not-found page), `/mod` (moderators and admins, one dense queue with the match chat of the selected item beside it).

- [ ] **Step 1: Write the failing tests:** `console-queue.test.ts` — ordering across the four kinds, `delayed` only past expected time with no result, finished and non-live tournaments excluded, a match with one report counts `reportCount: 1`. E2E `match-day.spec.ts` (seeded 4-team live tournament, players and a moderator via `createPlayer`): a captain checks in all players and sees the panel; a moderator posts the lobby on the console; both captains report and a deliberately different report creates a dispute; the moderator override completes the match and the winner's next match opens on the winner's page without reload; a player outside the match gets the not-found page; a chat message sent by one captain appears for the other.
- [ ] **Step 2:** Run `bun test tests/server/matchday/console-queue.test.ts` → FAIL.
- [ ] **Step 3: Implement** the queue, the functions (thin wrappers over Tasks 3–9, each with Zod input) and the pages following `DESIGN.md`; the match page works without JavaScript for reading (server-rendered) and uses plain forms plus `use-realtime` for updates. Strings in es-AR.
- [ ] **Step 4:** Run `bun test` → PASS; run `bun run typecheck` → clean; run `bun run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat: add match page, check-in panel and moderator console`

---

## Self-review notes

- Spec coverage: §5.6 → Tasks 1, 3, 4; §5.7 → Tasks 2, 4, 5, 6, 8, 9; §5.10 fallback column → Tasks 5, 9 (Riot-approved paths stay Plan 7); §5.11 moderator console → Task 10; §4 moderator powers → Task 6; §5.12 reminders → deferred, listed in Builder's calls.
- Type consistency: `MatchPhase`, `MatchStatus`, `ShortHandedDecision`, `CheckInOutcome` are defined in Task 1 and reused unchanged; `startBracket`/`syncMatches` are defined in Task 4 but their tables and `getMatchView` in Tasks 3 and 5.
