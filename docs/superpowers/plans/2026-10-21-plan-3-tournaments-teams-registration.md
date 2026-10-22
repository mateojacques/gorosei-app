# Plan 3: Tournaments, Teams & Registration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins create tournaments with per-tournament eligibility rules; players form teams, register rosters that are validated against frozen rank snapshots, and get confirmed once 5 players are marked paid; registration closes automatically, turning stranded payments into entry credits. The landing page and profiles switch from placeholder config to real data.

**Architecture:** The eligibility engine and prize math are pure modules in `src/shared/` (one engine, rules stored as typed JSON). Domain services live in `src/server/teams/` and `src/server/tournaments/`, take `db` (and `riot` where needed) as arguments, run mutations in transactions with their audit entries, and return `{ ok: true, … } | { ok: false, reason }`. Confirmation and cap slots are decided by one function, `recomputeConfirmations`, called after every mutation that can change them. Pages call thin `*.functions.ts` server functions, following the Plan 1 pattern of importing server modules inside the handlers.

**Tech Stack:** Existing stack (Bun, TanStack Start, React 19, Drizzle/Postgres, Better Auth, pg-boss, Zod, Tailwind v4 + the Plan 2 "En vivo" components). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-gorosei-mvp-design.md` §5.2–5.4 (plus §5.9 profiles, §5.11 admin tools). **Roadmap:** `docs/superpowers/plans/2026-10-21-gorosei-roadmap.md`. **Design system:** `DESIGN.md`, `PRODUCT.md`.

## Global Constraints

- LAS only; no region field or filter anywhere.
- No in-platform payments. Fees are paid outside the platform (Mercado Pago); an admin marks each player paid.
- Fee is per player; **subs don't pay**. A registration is **confirmed once 5 of its roster players have paid** (or immediately, when `entryFeeArs` is 0) and its roster is complete and eligible.
- **Unconfirmed teams don't hold a cap slot.** At registration close, unconfirmed teams are dropped and their paid players get **entry credits**. A confirmed team that withdraws gets no refund or credit. If we cancel, every paid player gets a credit.
- The prize pool is the sum of paid entry fees on confirmed rosters; the prize is paid from the real pool by the configured split. The "pool is the prize" line sits next to the fee and the prize meter everywhere.
- Eligibility is per tournament, never platform-wide. Rank source per tournament: `current` or `peak_season` (default `peak_season`).
- Eligibility is checked when a roster changes and when a team registers, using a rank snapshot taken at that moment and stored on the registration. Later rank polling never knocks out a registration.
- A verified Riot account is required to create or join a team and to be on a registration roster.
- Roster: exactly `ROSTER_STARTERS = 5` starters to be confirmed; 0–2 subs per tournament.
- Every admin mutation and every payment, credit, exception, cancellation and status transition writes `writeAudit` in the same transaction.
- Every user-facing string goes through `t()` (es-AR, "vos" forms). Store UTC, display `America/Argentina/Buenos_Aires` (fixed UTC−03:00, no DST).
- Public pages (`/torneos/$slug`, `/equipos/$slug`, `/jugador/$riotId`, `/`) are server-rendered and readable without JavaScript.
- UI follows `DESIGN.md`: signal red only for the status tag and the one primary action per screen. Impeccable bans apply: no card grids, gradient text, glassmorphism, side-stripe borders, an eyebrow above every section, or radius > 16px.
- Domain functions never throw for expected failures; they return a typed reason, and each reason has an i18n message.

## Review Focus

1. **Two teams racing for the last cap slot** (two payment marks committing at once) — never more confirmed teams than `teamCap`; the loser is `waitlisted`. → Task 5 test.
2. **Free tournaments** (`entryFeeArs: 0`) — a full eligible roster confirms with no payment step, and the UI shows no pay instructions or "0/5 pagos". → Task 5 test, Task 8 e2e.
3. **One player on two teams registering for the same tournament** — the second roster is rejected; after the first registration is withdrawn or dropped, it is allowed. → Task 4 test.
4. **Unranked and apex-tier players under rank rules** — unranked fails a minimum, passes a maximum, counts as Iron IV in averages and as `unrankedPoints` in budgets; Master+ compare correctly against division caps. → Task 1 tests.
5. **Registration close running twice, or cancel after close** — no duplicate credits; at most one credit per player per source tournament. → Task 6 test.

## Builder's calls (made here, not confirmed by the owner)

- **Waitlist:** a team that qualifies (5 paid, eligible, full) while all slots are taken becomes `waitlisted`, ordered by when it qualified; it is promoted automatically when a slot frees before close; at close it is dropped and its paid players get credits.
- **Pending-team withdrawal:** a team withdrawing *before* it is confirmed forfeits nothing; its players' payments stay attached to the tournament (they can join another team) and become credits at close if unused. Only a *confirmed* team's withdrawal forfeits its payments.
- **Roster changes never break eligibility:** a change that would make the roster ineligible is rejected with the failure messages. A confirmed team's change must also keep it confirmed. A player on a confirmed roster can't leave or be removed from the team until the captain replaces them.
- **Registration opening is a manual admin action** (`draft → registration_open`); **closing is automatic** at `registrationClosesAt` (a pg-boss job every minute). Recurring templates that open editions automatically are Plan 7.
- **Invites are by Riot ID only** (platform names are not unique).
- **No team logo upload** in this plan (needs file storage); teams have name + tag. Logos come with team profiles in Plan 6.
- **Admin edits eligibility rules as validated JSON** with a live human-readable preview, not a per-rule form.
- **Roster composition** (5 starters, `maxSubs`, `subsCountForTeamRules`) is stored as tournament columns, not as a rule, since every tournament needs it.
- **Unranked in averages** counts as Iron IV; **"ranked games this season"** is `wins + losses` of the latest rank snapshot.
- **Rank source `current`:** the snapshot first fetches a fresh rank from Riot; if Riot is unavailable it falls back to the latest stored snapshot.
- **Landing prize:** the big number is the champion's share of the prize *goal*, captioned as such; the current pool is shown next to the fee.

---

## File Structure

```
src/shared/eligibility.ts            rule types, Zod schema, evaluateEligibility, describeRule
src/shared/prize.ts                  prizePoolArs, splitPrize
src/shared/slug.ts                   slugify
src/shared/tournament.ts             statuses, constants, tournamentInputSchema
src/shared/art-datetime.ts           datetime-local <-> Date in ART
src/server/db/schema/competition.ts  tournaments, teams, team_members, team_requests, registrations,
                                     registration_players, eligibility_exceptions, entry_payments, entry_credits
src/server/teams/teams.ts            team domain service
src/server/tournaments/tournaments.ts  tournament CRUD, open, featured
src/server/tournaments/registrations.ts  register, roster, withdraw, snapshots, views
src/server/tournaments/confirmations.ts  recomputeConfirmations, payments, exceptions, force remove
src/server/tournaments/credits.ts    close, cancel, credits
src/server/jobs/close-registrations.ts
src/server/teams/teams.functions.ts, src/server/tournaments/{tournaments,admin}.functions.ts
src/components/tournament/*          prize meter, roster table, eligibility summary, failures list
src/routes/equipos.nuevo.tsx, equipos.$slug.tsx, mis-equipos.tsx
src/routes/torneos.$slug.tsx, torneos.$slug.inscribir.tsx, torneos.$slug.equipos.$teamSlug.tsx
src/routes/admin.tsx (layout, admin-only), admin.torneos.index.tsx, admin.torneos.nuevo.tsx, admin.torneos.$id.tsx
tests/shared/{eligibility,prize,slug,tournament,art-datetime}.test.ts
tests/server/teams/teams.test.ts, tests/server/tournaments/{tournaments,registrations,confirmations,credits}.test.ts
tests/helpers/competition.ts         createTestTournament, createTestTeam, linkedPlayer
e2e/helpers/players.ts               createPlayer (session + Riot account + rank + role)
e2e/{teams,registration,admin-tournaments,admin-payments}.spec.ts
```

---

### Task 1: Eligibility engine (pure)

**Files:**
- Create: `src/shared/eligibility.ts`
- Modify: `src/shared/i18n/es-AR.ts`
- Test: `tests/shared/eligibility.test.ts`

**Interfaces:**
- Consumes: `Rank`, `Tier`, `Division`, `rankValue`, `formatRank`, `TIERS`, `DIVISIONS` from `src/shared/rank.ts`; `t`, `MessageKey`.
- Produces:
  ```ts
  type RankBound = { tier: Tier; division: Division };
  type EligibilityRule =
    | { id: string; type: "player_rank_range"; min?: RankBound; max?: RankBound }
    | { id: string; type: "team_average_max"; max: RankBound }
    | { id: string; type: "point_budget"; points: Partial<Record<Tier, number>>; unrankedPoints: number; maxTotal: number }
    | { id: string; type: "max_players_above"; count: number; above: RankBound }
    | { id: string; type: "account_minimums"; minLevel?: number; minRankedGames?: number };
  const eligibilityRulesSchema: z.ZodType<EligibilityRule[]>;   // ids unique, ≤ 20 rules
  type PlayerSnapshot = { userId: string; riotId: string; rank: Rank | null; summonerLevel: number; rankedGames: number; takenAt: string };
  type RosterEntry = PlayerSnapshot & { isSub: boolean };
  type RosterOptions = { subsCountForTeamRules: boolean; exemptRuleIds: readonly string[] };
  type EligibilityFailure = { ruleId: string; userId?: string; messageKey: MessageKey; params: Record<string, string | number> };
  evaluateEligibility(rules: EligibilityRule[], roster: RosterEntry[], options: RosterOptions): EligibilityFailure[];  // [] = eligible
  describeRule(rule: EligibilityRule): string;
  formatFailure(f: EligibilityFailure): string;
  ```
  Per-player rules (`player_rank_range`, `account_minimums`) apply to every roster entry, subs included. Team rules (`team_average_max`, `point_budget`, `max_players_above`) apply to starters, plus subs when `subsCountForTeamRules`. Rules in `exemptRuleIds` are skipped. Comparisons use `rankValue` (LP ignored). Unranked: fails `min`, passes `max`, counts as value 0 (Iron IV) in averages, `unrankedPoints` in budgets, never "above". An empty roster passes team rules.

- [ ] **Step 1: Write the failing tests** `tests/shared/eligibility.test.ts`, with a `player(userId, rank, { level = 100, games = 50, isSub = false })` helper:
  - `rejects a player above the max rank`: rule `{id:"r1", type:"player_rank_range", max:{tier:"DIAMOND",division:"IV"}}`, a `DIAMOND III` player → one failure `{ruleId:"r1", userId, messageKey:"eligibility.fail.rank_above"}`; a `DIAMOND IV` player → `[]`.
  - `unranked fails a minimum and passes a maximum`.
  - `apex tiers are above any division cap`: `MASTER` vs max `DIAMOND I` → failure.
  - `team average counts unranked as Iron IV`: max `GOLD IV`; starters 4× `PLATINUM IV` (value 16) + 1 unranked → average 12.8 > 12 (`GOLD IV`) → failure; replacing the unranked with `IRON IV` gives the same result; 4× `GOLD IV` + 1 unranked passes.
  - `point budget sums starters only unless subs count`: points `{GOLD:2, PLATINUM:3}`, `unrankedPoints:1`, `maxTotal:12`; 4× PLATINUM + 1 GOLD = 14 → failure with params `{total:14, max:12}`; a PLATINUM sub is ignored when `subsCountForTeamRules:false` and counted when true.
  - `max players above`: `count:1, above:{tier:"EMERALD",division:"I"}`; two DIAMOND starters → failure `eligibility.fail.max_players_above`; `formatFailure` of it → `"Tu roster rompe una regla: máximo 1 jugador por encima de Esmeralda I."`.
  - `account minimums check level and ranked games`, each failure carrying its `userId`.
  - `exempt rules are skipped`.
  - `schema rejects duplicate rule ids and unknown types`; accepts the rule list used above.
  - `describeRule` → `"Rango máximo por jugador: Diamante IV"` for the r1 rule.
- [ ] **Step 2:** Run `bun test tests/shared/eligibility.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement. i18n keys `eligibility.fail.{rank_above,rank_below,team_average,point_budget,max_players_above,min_level,min_ranked_games}` and `eligibility.describe.{player_rank_range,team_average_max,point_budget,max_players_above,account_minimums}`; player-scoped messages take `{player}` (the Riot ID). Use singular/plural via two keys where the count can be 1 (`…_one` / `…_other`).
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add eligibility rule engine`

### Task 2: Tournament model and admin service

**Files:**
- Create: `src/shared/tournament.ts`, `src/shared/prize.ts`, `src/shared/slug.ts`, `src/server/db/schema/competition.ts` (tournaments only in this task), `src/server/tournaments/tournaments.ts`, migration via `bun run db:generate`, `tests/helpers/competition.ts`
- Modify: `src/server/db/schema/index.ts`
- Test: `tests/shared/{prize,slug,tournament}.test.ts`, `tests/server/tournaments/tournaments.test.ts`

**Interfaces:**
- Consumes: `eligibilityRulesSchema`, `EligibilityRule` (Task 1); `RankSource` (`src/server/identity/ranks.ts`); `writeAudit`, `Db`, `Executor`.
- Produces:
  ```ts
  // src/shared/tournament.ts
  TOURNAMENT_STATUSES = ["draft","registration_open","registration_closed","check_in","live","finished","cancelled"] as const;
  type TournamentStatus; ROSTER_STARTERS = 5;
  tournamentInputSchema: z.object({ title (3–80), edition (int ≥ 1), startsAt: z.coerce.date(), registrationClosesAt: z.coerce.date(),
    bracket: "double_elimination"|"single_elimination", draftMode: "tournament_draft"|"blind_pick", bestOf: 1|3|5, finalsBestOf: 1|3|5, teamCap (int 2–128),
    maxSubs (int 0–2), subsCountForTeamRules: boolean, rankSource: "current"|"peak_season", eligibilityRules,
    entryFeeArs (int ≥ 0), prizeGoalArs (int ≥ 0), prizeSplit (1–8 positive ints summing to 100),
    paymentInstructions (≤ 2000), rulesText (≤ 20000), streamUrl (url or "") })
    .refine(registrationClosesAt < startsAt);
  type TournamentInput = z.infer<typeof tournamentInputSchema>;
  // src/shared/prize.ts
  prizePoolArs(paidEntries: number, entryFeeArs: number): number;
  splitPrize(poolArs: number, split: number[]): number[];   // floors each share; remainder goes to 1st place
  // src/shared/slug.ts
  slugify(s: string): string;   // lowercase, accents stripped, non-alphanumerics → "-", trimmed
  // src/server/tournaments/tournaments.ts
  type Tournament = typeof tournaments.$inferSelect;
  createTournament(db, actorUserId, input: TournamentInput): Promise<{ id: string; slug: string }>;  // status "draft"; slug `${slugify(title)}-${edition}`, "-2", "-3"… on collision
  updateTournament(db, actorUserId, id, input): Promise<{ ok: true } | { ok: false; reason: "not_found" | "not_editable" }>;  // finished/cancelled not editable
  openRegistration(db, actorUserId, id): Promise<{ ok: true } | { ok: false; reason: "not_found" | "invalid_state" }>;      // draft → registration_open
  getTournamentBySlug(db, slug): Promise<Tournament | null>; getTournamentById(db, id): Promise<Tournament | null>;
  listTournaments(db): Promise<Tournament[]>;   // newest startsAt first
  getFeaturedTournament(db): Promise<Tournament | null>;  // earliest-starting in registration_open; else earliest in registration_closed/check_in/live; never draft/finished/cancelled
  // tests/helpers/competition.ts
  createTestTournament(overrides?: Partial<TournamentInput> & { status?: TournamentStatus }): Promise<Tournament>;
  ```
  Table `tournaments`: the input fields plus `id` uuid, `slug` unique, `status` (default `draft`), `createdBy`, `createdAt`, `updatedAt`; `eligibilityRules` and `prizeSplit` as `jsonb`.

- [ ] **Step 1: Write the failing tests:**
  - `prize.test.ts`: `splitPrize(300000, [70, 30])` → `[210000, 90000]`; `splitPrize(100001, [70, 30])` → `[70001, 30000]`; `prizePoolArs(15, 5000)` → `75000`.
  - `slug.test.ts`: `slugify("Copa Semanal LAS")` → `"copa-semanal-las"`; `slugify("  Los Pibes del Café!! ")` → `"los-pibes-del-cafe"`.
  - `tournament.test.ts`: the schema rejects `registrationClosesAt >= startsAt`, a split summing to 90, `maxSubs: 3`; accepts a full valid input.
  - `tournaments.test.ts` (DB): `createTournament` returns slug `copa-semanal-las-1`, a second with the same title and edition gets `copa-semanal-las-1-2`, both write `tournament.created` audit rows; `openRegistration` moves draft → `registration_open` and a second call returns `invalid_state`; `updateTournament` on a cancelled tournament returns `not_editable`; `getFeaturedTournament` prefers an open tournament starting later over a closed one starting sooner, and ignores drafts.
- [ ] **Step 2:** Run `bun test tests/shared tests/server/tournaments` → FAIL.
- [ ] **Step 3:** Implement the schema, run `bun run db:generate`, implement the modules. Audit actions: `tournament.created`, `tournament.updated`, `tournament.registration_opened`.
- [ ] **Step 4:** Run `bun test` and `bunx tsc --noEmit` → PASS / clean.
- [ ] **Step 5: Commit** `feat: add tournament model and admin service`

### Task 3: Teams, invites and join requests

**Files:**
- Modify: `src/server/db/schema/competition.ts` (add `teams`, `team_members`, `team_requests`), migration
- Create: `src/server/teams/teams.ts`
- Modify: `tests/helpers/competition.ts`, `src/shared/i18n/es-AR.ts`
- Test: `tests/server/teams/teams.test.ts`

**Interfaces:**
- Consumes: `slugify` (Task 2), `parseRiotId`, `riotAccounts`, `getCurrentRank`.
- Produces:
  ```ts
  type TeamRequest = { id: string; teamId: string; userId: string; kind: "invite" | "join_request"; status: "pending" | "accepted" | "declined" | "cancelled" };
  createTeam(db, userId, input: { name: string; tag: string }): Promise<{ ok: true; teamId: string; slug: string } | { ok: false; reason: "riot_required" | "invalid_name" | "invalid_tag" | "name_taken" | "tag_taken" }>;
    // name 3–24 chars trimmed; tag 2–5 of [A-Z0-9], stored uppercase; name unique case-insensitively, tag unique; creator becomes captain
  inviteByRiotId(db, captainId, teamId, riotIdInput): Promise<{ ok: true; requestId: string } | { ok: false; reason: "not_captain" | "invalid_riot_id" | "player_not_found" | "already_member" | "already_pending" }>;
  requestToJoin(db, userId, teamId): Promise<{ ok: true; requestId: string } | { ok: false; reason: "riot_required" | "already_member" | "already_pending" }>;
  respondToRequest(db, actorId, requestId, accept: boolean): Promise<{ ok: true } | { ok: false; reason: "not_allowed" | "not_pending" }>;
    // invites are answered by the invited user, join requests by the captain
  cancelRequest(db, actorId, requestId): Promise<{ ok: true } | { ok: false; reason: "not_allowed" | "not_pending" }>;  // captain cancels an invite, requester cancels a request
  leaveTeam(db, userId, teamId): Promise<{ ok: true } | { ok: false; reason: "not_member" | "captain_must_transfer" }>;
  removeMember(db, captainId, teamId, userId): Promise<{ ok: true } | { ok: false; reason: "not_captain" | "not_member" }>;
  transferCaptain(db, captainId, teamId, newCaptainId): Promise<{ ok: true } | { ok: false; reason: "not_captain" | "not_member" }>;
  type TeamView = { id; slug; name; tag; captainUserId; members: { userId; gameName; tagLine; role: "captain" | "member"; currentRank: Rank | null }[] };
  getTeamBySlug(db, slug): Promise<TeamView | null>;
  listTeamsForUser(db, userId): Promise<{ id; slug; name; tag; role }[]>;
  listPendingRequestsForUser(db, userId): Promise<{ invites: (TeamRequest & { teamName; teamSlug })[]; requests: (TeamRequest & { teamName; teamSlug })[] }>;
  listPendingRequestsForTeam(db, teamId): Promise<(TeamRequest & { gameName; tagLine })[]>;
  // tests/helpers/competition.ts
  linkedPlayer(id: string, rank?: Rank | null, opts?: { level?: number; games?: number }): Promise<string>;  // user + Riot account + snapshot; returns userId
  createTestTeam(captainId: string, memberIds?: string[], name?: string): Promise<{ id: string; slug: string }>;
  ```
  Accepting adds a `team_members` row (`role: "member"`). A partial unique index allows one `pending` request per (team, user). Leave and remove are extended in Task 4 with the confirmed-roster guard.

- [ ] **Step 1: Write the failing tests** in `teams.test.ts`:
  - `creating a team requires a linked Riot account` → `riot_required`; with one → captain membership exists.
  - `team names are unique case-insensitively and tags are uppercased` (`"pibes"` → `name_taken` after `"Pibes"`; tag `"pbs"` stored `"PBS"`).
  - `inviting by Riot ID finds the player case-insensitively` (`"señor café#las"` resolves the `Señor Café#LAS` account); unknown → `player_not_found`; a non-captain → `not_captain`; inviting twice → `already_pending`.
  - `accepting an invite adds the member; only the invited user can answer it`.
  - `join requests are answered by the captain only`.
  - `the captain can't leave without transferring captaincy`; after `transferCaptain` they can.
  - `getTeamBySlug lists members with their current rank`.
- [ ] **Step 2:** Run `bun test tests/server/teams` → FAIL.
- [ ] **Step 3:** Implement schema, migration, service; i18n keys `team.error.<reason>` for every reason above.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add teams, invites and join requests`

### Task 4: Registrations, rosters and rank snapshots

**Files:**
- Modify: `src/server/db/schema/competition.ts` (add `registrations`, `registration_players`, `eligibility_exceptions`), migration
- Create: `src/server/tournaments/registrations.ts`
- Modify: `src/server/teams/teams.ts` (leave/remove guard), `src/shared/i18n/es-AR.ts`, `tests/helpers/competition.ts`
- Test: `tests/server/tournaments/registrations.test.ts`

**Interfaces:**
- Consumes: Task 1 engine; `Tournament`, `ROSTER_STARTERS` (Task 2); teams (Task 3); `getEffectiveRank`, `recordRankSnapshot`, `RankDeps` (Plan 1).
- Produces:
  ```ts
  REGISTRATION_STATUSES = ["pending","confirmed","waitlisted","withdrawn","dropped"] as const;  // in src/shared/tournament.ts
  type RegistrationDeps = { db: Db; riot: RiotClient; now?: () => Date };
  type RosterInput = { starters: string[]; subs: string[] };   // user ids
  type RosterRejection = "not_captain" | "registration_closed" | "already_registered" | "player_not_member" | "player_already_registered"
    | "riot_required" | "too_many_starters" | "too_many_subs" | "locked" | "would_unconfirm" | "ineligible";
  type RosterResult = { ok: true; registrationId: string } | { ok: false; reason: RosterRejection; failures?: EligibilityFailure[] };
  takePlayerSnapshot(deps, userId, rankSource: RankSource): Promise<PlayerSnapshot | null>;   // null = no Riot account
  registerTeam(deps, captainId, tournamentId, teamId, roster: RosterInput): Promise<RosterResult>;      // only while registration_open
  updateRoster(deps, captainId, registrationId, roster: RosterInput): Promise<RosterResult>;           // registration_open or registration_closed; keeps snapshots of kept players, snapshots added ones
  withdrawRegistration(db, captainId, registrationId): Promise<{ ok: true } | { ok: false; reason: "not_captain" | "locked" }>;
  type RegistrationView = { id; status; tournamentId; team: { id; slug; name; tag; captainUserId };
    roster: (RosterEntry & { paid: boolean })[]; paidCount: number; failures: EligibilityFailure[] };
  getRegistrationView(db, registrationId): Promise<RegistrationView | null>;
  getRegistrationForTeam(db, tournamentId, teamSlug): Promise<RegistrationView | null>;
  listRegistrations(db, tournamentId): Promise<RegistrationView[]>;   // confirmed, waitlisted, pending; then withdrawn/dropped
  evaluateRegistration(tournament: Tournament, roster: RosterEntry[], exemptRuleIds: string[]): EligibilityFailure[];
  // tests/helpers/competition.ts
  createTestRegistration(tournamentId, teamId, roster: RosterInput): Promise<string>;
  ```
  `registration_players`: (`registrationId`, `userId`) PK, `tournamentId`, `riotAccountId`, `isSub`, `snapshot` jsonb (`PlayerSnapshot`), `active` boolean; unique index on (`tournamentId`, `userId`) **where active** — the database guarantees one active roster per player per tournament. Withdrawn/dropped registrations set their rows inactive. `eligibility_exceptions`: PK (`tournamentId`, `teamId`, `ruleId`), `reason`, `grantedBy`, `grantedAt`. `paid` is always `false` in this task (payments arrive in Task 5). `leaveTeam`/`removeMember` now return `"on_confirmed_roster"` when the player is on an active roster of a `confirmed` registration, and otherwise also drop the player from active pending rosters.

- [ ] **Step 1: Write the failing tests** in `registrations.test.ts`:
  - `registering stores a snapshot per player`: a PLATINUM II player under `peak_season` → `snapshot.rank` PLATINUM II, `summonerLevel` and `rankedGames` from the Riot account and latest snapshot.
  - `an ineligible roster is rejected with its failures` (max-rank rule, a DIAMOND player) → `{ ok:false, reason:"ineligible", failures:[{ruleId…}] }`, no rows written.
  - `rank changes after registering don't affect the stored snapshot` (record a higher snapshot after registering → `getRegistrationView` failures stay `[]`).
  - `a player can't be on two active rosters in one tournament` → `player_already_registered`; after `withdrawRegistration` of the first → the second registration succeeds.
  - `non-members, too many starters (6) and too many subs (maxSubs+1) are rejected`.
  - `registerTeam only works while registration is open` → `registration_closed` for a draft.
  - `updateRoster keeps existing snapshots and snapshots new players` (assert `takenAt` unchanged for a kept player).
  - `rank source current refreshes from Riot first`, and falls back to the stored snapshot when the fake Riot client is unavailable.
  - `leaving the team drops the player from a pending roster`.
- [ ] **Step 2:** Run `bun test tests/server/tournaments/registrations.test.ts` → FAIL.
- [ ] **Step 3:** Implement. i18n `registration.error.<reason>`.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add tournament registration with frozen rank snapshots`

### Task 5: Payments, confirmation, cap slots and exceptions

**Files:**
- Modify: `src/server/db/schema/competition.ts` (add `entry_payments`), migration
- Create: `src/server/tournaments/confirmations.ts`
- Modify: `src/server/tournaments/registrations.ts` (call recompute; forfeit on confirmed withdraw; `paid` in views), `src/server/tournaments/tournaments.ts` (`updateTournament` calls recompute), `src/server/teams/teams.ts` (the Task 4 guard now sees real confirmations)
- Test: `tests/server/tournaments/confirmations.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces:
  ```ts
  // entry_payments: id, tournamentId, userId, source "payment" | "credit", reference text, creditId uuid | null,
  //                 forfeited boolean default false, recordedBy, recordedAt; unique (tournamentId, userId)
  recomputeConfirmations(tx: Executor, tournamentId: string, now: Date): Promise<void>;
  markPaid(db, adminId, tournamentId, userIds: string[], reference: string): Promise<{ ok: true; marked: number }>;   // already-paid users skipped
  unmarkPaid(db, adminId, tournamentId, userId): Promise<{ ok: true } | { ok: false; reason: "not_paid" }>;          // credit-sourced payment returns the credit to available (Task 6 wires the credit side)
  grantEligibilityException(db, adminId, { tournamentId, teamId, ruleId, reason }): Promise<{ ok: true }>;
  revokeEligibilityException(db, adminId, { tournamentId, teamId, ruleId }): Promise<{ ok: true }>;
  forceRemoveRegistration(db, adminId, registrationId, reason: string): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;  // → dropped, rows inactive
  ```
  `recomputeConfirmations` locks the tournament row (`SELECT … FOR UPDATE`), then, for registrations in pending/confirmed/waitlisted: a registration **qualifies** when it has 5 starters, `evaluateRegistration` returns no failures (exceptions applied), and `paidCount >= 5` or `entryFeeArs === 0`. Set `qualifiedAt` the first time it qualifies; clear it when it stops. Confirmed registrations that still qualify keep their slots; the remaining `teamCap − kept` slots go to other qualifying registrations by `qualifiedAt` ascending; qualifying leftovers become `waitlisted`; non-qualifying become `pending`. Every status change writes an audit row (`registration.confirmed`, `.waitlisted`, `.unconfirmed`). Only runs while the tournament is `registration_open`; after close, statuses are final except via withdraw/force-remove. `updateRoster` on a confirmed registration returns `would_unconfirm` if the new roster would not qualify. `withdrawRegistration` of a confirmed registration sets `forfeited = true` on its roster players' payments.

- [ ] **Step 1: Write the failing tests** in `confirmations.test.ts`:
  - `a team is confirmed when 5 roster players are paid`: 4 paid → pending, "4/5"; 5th → confirmed, `registration.confirmed` audit row.
  - `subs don't need to pay but a paid sub counts toward 5`.
  - `free tournaments confirm a full eligible roster without payments` (`entryFeeArs: 0`).
  - `confirmation waits for a full roster` (4 starters, 4 paid, fee 0 → pending).
  - `cap full sends the next qualifying team to the waitlist and promotes it when a slot frees`: `teamCap: 2`, three teams qualify in order → confirmed, confirmed, waitlisted; the first withdraws → the waitlisted one is confirmed and the withdrawn team's payments are forfeited.
  - `two payment marks racing for the last slot never exceed the cap`: `teamCap: 1`, two teams with 4 paid each, `await Promise.all([markPaid(team A 5th), markPaid(team B 5th)])` → exactly one confirmed, one waitlisted.
  - `an eligibility exception lets an ineligible roster qualify`, and revoking it before close unconfirms it.
  - `lowering teamCap via updateTournament waitlists the most recently qualified team`.
  - `a confirmed roster change that would unconfirm is rejected` (`would_unconfirm`).
  - `unmarking a payment unconfirms the team` and writes `payment.unmarked`.
- [ ] **Step 2:** Run `bun test tests/server/tournaments/confirmations.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Audit actions `payment.marked`, `payment.unmarked`, `eligibility.exception_granted`, `eligibility.exception_revoked`, `registration.force_removed`.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: confirm registrations on payment with cap slots and waitlist`

### Task 6: Registration close, cancellation and entry credits

**Files:**
- Modify: `src/server/db/schema/competition.ts` (add `entry_credits`), migration
- Create: `src/server/tournaments/credits.ts`, `src/server/jobs/close-registrations.ts`
- Modify: `src/server/jobs/boss.ts`, `src/server/tournaments/confirmations.ts` (credit-sourced unmark)
- Test: `tests/server/tournaments/credits.test.ts`, `tests/server/jobs/close-registrations.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5.
- Produces:
  ```ts
  // entry_credits: id, userId, sourceTournamentId uuid | null, reason "unconfirmed" | "waitlisted" | "cancelled" | "manual",
  //   status "available" | "used" | "revoked", usedPaymentId uuid | null, note text, createdBy text | null, createdAt;
  //   unique (userId, sourceTournamentId)  — null sources (manual credits) never conflict
  closeRegistration(db, tournamentId, now: Date, actorUserId: string | null): Promise<{ ok: true; dropped: number; credited: number } | { ok: false; reason: "invalid_state" }>;
  cancelTournament(db, adminId, tournamentId, reason: string): Promise<{ ok: true; credited: number } | { ok: false; reason: "invalid_state" }>;  // not finished/cancelled
  applyCredit(db, adminId, creditId, tournamentId): Promise<{ ok: true } | { ok: false; reason: "credit_unavailable" | "already_paid" }>;   // creates a source "credit" payment, then recompute
  grantManualCredit(db, adminId, userId, note: string): Promise<{ ok: true; creditId: string }>;
  revokeCredit(db, adminId, creditId): Promise<{ ok: true } | { ok: false; reason: "credit_unavailable" }>;
  type EntryCredit = typeof entryCredits.$inferSelect;
  listCreditsForUser(db, userId): Promise<EntryCredit[]>;
  closeDueRegistrations(db, now: Date): Promise<{ closed: number }>;   // every registration_open tournament with registrationClosesAt <= now
  ```
  Close: status → `registration_closed`; pending and waitlisted registrations → `dropped` (rows inactive); every non-forfeited payment whose player is not on an active roster of a confirmed registration gets a credit (`waitlisted` if their registration was waitlisted, else `unconfirmed`), inserted with `onConflictDoNothing`. Cancel: status → `cancelled`; every non-forfeited payment gets a `cancelled` credit (`onConflictDoNothing`). The job `close-registrations` runs every minute (`* * * * *`) and logs its count.

- [ ] **Step 1: Write the failing tests:**
  - `closing drops unconfirmed teams and credits their paid players`: one confirmed team, one pending with 3 paid → `{dropped:1, credited:3}`; confirmed players get no credit.
  - `waitlisted teams are dropped with waitlisted credits`.
  - `a confirmed team that withdrew gets no credit at close`.
  - `closing twice is a no-op` (second → `invalid_state`, credit count unchanged).
  - `cancelling credits every paid player once, even after close` (close, then cancel → confirmed players get `cancelled` credits, dropped players keep their single earlier credit).
  - `applying a credit pays the player and marks the credit used`; applying it again → `credit_unavailable`; unmarking that payment returns the credit to `available`.
  - `closeDueRegistrations closes only tournaments past their close time` (one past, one future, one draft).
- [ ] **Step 2:** Run `bun test tests/server/tournaments/credits.test.ts tests/server/jobs` → FAIL.
- [ ] **Step 3:** Implement and register the job. Audit actions `tournament.registration_closed`, `tournament.cancelled`, `credit.granted`, `credit.used`, `credit.revoked`, `credit.restored`.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: close registration and issue entry credits`

### Task 7: Team pages

**Files:**
- Create: `src/server/teams/teams.functions.ts`, `src/routes/equipos.nuevo.tsx`, `src/routes/equipos.$slug.tsx`, `src/routes/mis-equipos.tsx`, `e2e/helpers/players.ts`
- Modify: `src/server/viewer.functions.ts` (`ViewerState` signed-in branch gains `role: Role`), `src/components/site/site-header.tsx` (linked players also get a "Mis equipos" link), `src/shared/i18n/es-AR.ts`, `e2e/public-routes.ts` (seed a team; add `/equipos/<slug>`), `tests/shared/landing-cta.test.ts` (new `role` field)
- Test: `e2e/teams.spec.ts`

**Interfaces:**
- Consumes: Task 3 service; `Button`, `Input`, `Label`, `Field`, `FormAlert`, `CaptionBar`, `NotFound`.
- Produces:
  ```ts
  // e2e/helpers/players.ts
  createPlayer(opts: { name: string; email: string; riot?: { gameName: string; tagLine: string; rank?: Rank | null; level?: number }; role?: Role })
    : Promise<{ userId: string; storageState: StorageState }>;   // signs up via /api/auth/sign-up/email, inserts Riot account + snapshot, sets role
  ```
  Server functions (GET loaders / POST actions) wrapping every Task 3 function, each resolving the session user; actions return the service result unchanged. `/equipos/$slug` is public: team name (display type) and tag, roster with ranks; captain sees invite-by-Riot-ID form, pending requests with accept/decline/cancel, remove member, transfer captaincy; a member sees "Salir del equipo"; a signed-in linked non-member sees "Pedir unirme". `/mis-equipos` lists my teams, invites to me (accept/decline), my requests (cancel), and a primary "Crear equipo" link; signed out → sign-in prompt. `/equipos/nuevo` creates and navigates to the team page. Rosters render as a semantic `<table>`, not cards.

- [ ] **Step 1: Write the failing tests** `e2e/teams.spec.ts` (JS enabled, players from `createPlayer`):
  - A linked player creates "Los Pibes" / `PBS` → lands on `/equipos/los-pibes` showing `Los Pibes` in `<h1>` and `[PBS]`.
  - The captain invites `Señor Café#LAS`; that player sees the invite on `/mis-equipos`, accepts, and appears in the team roster table.
  - A player without Riot sees `team.error.riot_required` text in a `role="alert"` when creating a team.
  - JS disabled: `/equipos/los-pibes` HTML contains the team name and roster Riot IDs.
  - Add the seeded team route to `PUBLIC_ROUTES` (layout + shell specs cover it).
- [ ] **Step 2:** Run `bunx playwright test e2e/teams.spec.ts` → FAIL.
- [ ] **Step 3:** Implement the server functions, pages and helper, following `DESIGN.md` (display-type titles, tag in a caption bar, quiet empty states). After every action, `router.invalidate()`.
- [ ] **Step 4:** Run `bun test` and `bunx playwright test` → PASS. Screenshot `/equipos/<slug>` and `/mis-equipos` at 360 and 1280.
- [ ] **Step 5: Commit** `feat: add team pages`

### Task 8: Tournament page and team registration

**Files:**
- Create: `src/server/tournaments/tournaments.functions.ts`, `src/routes/torneos.$slug.tsx`, `src/routes/torneos.$slug.inscribir.tsx`, `src/routes/torneos.$slug.equipos.$teamSlug.tsx`, `src/components/tournament/{prize-meter,roster-table,eligibility-summary,failure-list,registration-status}.tsx`
- Modify: `src/shared/i18n/es-AR.ts`, `e2e/public-routes.ts` (seed an open tournament; add its pages)
- Test: `e2e/registration.spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5 (`listRegistrations`, `getRegistrationForTeam`, `registerTeam`, `updateRoster`, `withdrawRegistration`, `prizePoolArs`, `splitPrize`, `describeRule`, `formatFailure`); `CupCountdown`, `CaptionBar`, `Prize`.
- Produces: a public `TournamentView = { tournament fields shown publicly; poolArs; prizeShares: number[]; goalShares: number[]; confirmedCount; registrations: { teamName; teamSlug; status; paidCount; starterCount }[]; rules: string[] }` from `getTournamentPage({ slug })`.
  `/torneos/$slug` (public, SSR): status tag, title + edition, caption bar with date and countdown, format line (bracket, draft mode, best-of), **prize meter** (current pool vs goal, the split per place, and `t("tournament.poolWarning")` next to it), fee + payment instructions (hidden when the fee is 0), eligibility rules as a list from `describeRule`, roster size and subs, cap as "confirmados N/teamCap", registered teams table (status, "3/5 pagos" — omitted for free tournaments), rules text (preserving line breaks), stream link. Primary action while registration is open: "Inscribí tu equipo" → `/inscribir`. `/inscribir` (captain only): choose a team you captain that isn't registered, tick starters and subs from its members; rejections render with `formatFailure` messages in a `role="alert"` list. `/torneos/$slug/equipos/$teamSlug`: roster table with each player's snapshot rank and paid status, payment progress, registration status explained in one sentence (pending / confirmed / waitlisted / dropped / withdrawn); the captain can edit the roster (same picker) and withdraw (a confirmation step that states the forfeit rule when confirmed).

- [ ] **Step 1: Write the failing tests** `e2e/registration.spec.ts`:
  - JS disabled: `/torneos/<slug>` HTML contains the title, `$300.000` goal, `el pozo es el premio`, the rule description `Rango máximo por jugador: Diamante IV`, and `confirmados 0/16`.
  - JS enabled: a captain with 5 linked teammates registers them; the team page shows `0/5 pagos` and the pending explanation; the tournament page lists the team as pending.
  - A roster with a MASTER player is rejected and the alert contains the `eligibility.fail.rank_above` text with that player's Riot ID.
  - Free tournament (fee 0): after registering 5 eligible players the team page says confirmed, and the tournament page HTML contains no `pagos` and no payment instructions.
  - Add the tournament page and a registered team page to `PUBLIC_ROUTES`.
- [ ] **Step 2:** Run `bunx playwright test e2e/registration.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun test` and `bunx playwright test` → PASS. Screenshot the three pages at 360 and 1280; check the prize meter and the warning sit together on a 320px phone.
- [ ] **Step 5: Commit** `feat: add tournament page and team registration`

### Task 9: Admin tournament management

**Files:**
- Create: `src/shared/art-datetime.ts`, `src/server/tournaments/admin.functions.ts`, `src/routes/admin.tsx`, `src/routes/admin.torneos.index.tsx`, `src/routes/admin.torneos.nuevo.tsx`, `src/routes/admin.torneos.$id.tsx`, `src/components/tournament/tournament-form.tsx`
- Modify: `src/components/site/site-header.tsx` (admins get an "Admin" link), `src/shared/i18n/es-AR.ts`
- Test: `tests/shared/art-datetime.test.ts`, `e2e/admin-tournaments.spec.ts`

**Interfaces:**
- Consumes: Task 2 service, Task 6 `cancelTournament`, `requireRole(headers, "admin")`.
- Produces:
  ```ts
  fromArtDateTimeLocal(value: string): Date;   // "2026-11-07T18:00" → 2026-11-07T21:00:00Z
  toArtDateTimeLocal(d: Date): string;         // inverse, for <input type="datetime-local">
  ```
  `admin.tsx` is a layout route whose loader calls a server fn that throws `notFound()` unless the session user is an admin (non-admins and signed-out visitors get the "Sin señal" page, never a hint the admin area exists). `/admin/torneos`: table of tournaments (title, edition, ART start, status, confirmed/cap) + "Nuevo torneo". The form: every `TournamentInput` field; dates as `datetime-local` in ART; eligibility rules as a JSON `<textarea>` validated by `eligibilityRulesSchema` on submit, with a live preview list from `describeRule` (invalid JSON shows the Zod issue path and message in a `role="alert"`); prize split as comma-separated percentages. `/admin/torneos/$id`: the form (save) plus lifecycle actions — "Abrir inscripción" (draft), "Cerrar inscripción ahora" (registration_open, calls `closeRegistration`), "Cancelar torneo" (with a reason field and a confirmation step stating that every paid player gets a credit).

- [ ] **Step 1: Write the failing tests:**
  - `art-datetime.test.ts`: `fromArtDateTimeLocal("2026-11-07T18:00").toISOString() === "2026-11-07T21:00:00.000Z"`; `fromArtDateTimeLocal("2026-11-07T23:30")` → `2026-11-08T02:30:00.000Z`; `toArtDateTimeLocal` round-trips both.
  - `e2e/admin-tournaments.spec.ts`: a player (non-admin) gets a 404 on `/admin/torneos`; an admin creates "Copa Semanal LAS" #1 with a max-rank rule, sees `copa-semanal-las-1` as draft in the list, opens registration, and `/torneos/copa-semanal-las-1` then shows `Inscripción abierta`; submitting `[{"id":"r1","type":"nope"}]` as rules shows an alert and saves nothing.
- [ ] **Step 2:** Run `bun test tests/shared/art-datetime.test.ts` and `bunx playwright test e2e/admin-tournaments.spec.ts` → FAIL.
- [ ] **Step 3:** Implement. Admin pages use the product side of `DESIGN.md`: dense tables, Hanken body, display type for page titles only.
- [ ] **Step 4:** Run `bun test` and `bunx playwright test` → PASS.
- [ ] **Step 5: Commit** `feat: add admin tournament management`

### Task 10: Admin registrations, payments and credits

**Files:**
- Modify: `src/routes/admin.torneos.$id.tsx`, `src/server/tournaments/admin.functions.ts`, `src/shared/i18n/es-AR.ts`
- Create: `src/components/tournament/admin-registrations.tsx`
- Test: `e2e/admin-payments.spec.ts`

**Interfaces:**
- Consumes: Task 5 (`markPaid`, `unmarkPaid`, exceptions, `forceRemoveRegistration`), Task 6 (`applyCredit`, `listCreditsForUser`, `grantManualCredit`, `revokeCredit`), `listRegistrations`, Plan 1 `setRankOverride` / `clearRankOverride`.
- Produces: on `/admin/torneos/$id`, a registrations section grouped by status. Each registration shows its roster (Riot ID, snapshot rank, sub flag, paid ✓, available credits count), payment progress, and current failures. Actions: select players → "Marcar pagado" with a reference text (Mercado Pago operation number or note); per player "Desmarcar" and "Usar crédito" (only when they have an available credit); per failing rule "Otorgar excepción" with a reason; per registration "Quitar del torneo" with a reason. A player panel searches a player by Riot ID and lists, grants and revokes their credits, and sets or clears their rank override (Plan 1 `setRankOverride` / `clearRankOverride`, with a required reason). Every action shows the service's reason via `t()` on failure and refreshes with `router.invalidate()`.

- [ ] **Step 1: Write the failing test** `e2e/admin-payments.spec.ts`: seed an open tournament (`teamCap: 1`) with two registered 5-player teams. The admin marks all five players of team A paid with reference `MP-123` → team A shows confirmed and the public tournament page says `confirmados 1/1`; marks four of team B → `4/5`; marks the fifth → team B shows waitlisted. The admin closes registration → team B shows dropped and each of its five players has 1 available credit in the player panel. Setting a rank override on a player writes a `rank.override_set` audit row.
- [ ] **Step 2:** Run `bunx playwright test e2e/admin-payments.spec.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `bun test` and `bunx playwright test` → PASS.
- [ ] **Step 5: Commit** `feat: add admin payment marking and credits`

### Task 11: Landing page and profiles on real data

**Files:**
- Modify: `src/routes/index.tsx`, `src/components/cup/{stage,prize,cup-facts,cup-cta}.tsx`, `src/shared/landing-cta.ts`, `src/server/identity/profile.ts`, `src/routes/jugador.$riotId.tsx`, `src/shared/i18n/es-AR.ts`, `e2e/landing.spec.ts`, `e2e/session-flow.spec.ts`, `e2e/public-routes.ts`, `DESIGN.md` (status tag states)
- Delete: `src/shared/featured-cup.ts`, `tests/shared/featured-cup.test.ts`
- Test: `tests/shared/landing-cta.test.ts`, `tests/server/identity/profile.test.ts`, `e2e/landing.spec.ts`, `e2e/profile.spec.ts`

**Interfaces:**
- Consumes: `getFeaturedTournament` (Task 2), `TournamentView` builder (Task 8), registrations (Task 4).
- Produces:
  ```ts
  getLandingCta(viewer: ViewerState, tournament: { slug: string; status: TournamentStatus } | null): LandingCta;
    // signed out → "cup.cta.signUp" /ingresar; no Riot → "cup.cta.linkRiot" /vincular-riot;
    // linked + registration_open → "cup.cta.register" /torneos/<slug>/inscribir;
    // linked + other status → "cup.cta.viewTournament" /torneos/<slug>; linked + no tournament → "cup.cta.ready" (profile)
  PublicProfile.teams: { name: string; tag: string; slug: string }[];
  PublicProfile.tournaments: { title: string; edition: number; slug: string; startsAt: Date; teamName: string }[];  // confirmed registrations, newest first
  ```
  The landing loads the featured tournament through a server fn. Mapping: status tag from tournament status (`registration_open` "Inscripción abierta", `registration_closed` "Inscripción cerrada", `check_in` "Check-in abierto", `live` "En vivo"); the prize block shows `splitPrize(prizeGoalArs, prizeSplit)[0]` captioned `t("cup.prizeCaptionGoal")` ("Premio para el campeón con el cupo lleno"); the facts read from the tournament (who from `describeRule` of its rules, what from bracket + cap, where from `streamUrl`, entry from fee + `cup.poolNote` + current pool); the caption bar keeps the countdown. With no featured tournament the stage shows `t("cup.none.title")` and `t("cup.none.body")` and the CTA still follows the viewer state. The profile lists teams (links to `/equipos/<slug>`) and confirmed tournament registrations (links to `/torneos/<slug>`), keeping the quiet empty states.

- [ ] **Step 1: Write the failing tests:**
  - `landing-cta.test.ts`: the five cases above, with exact hrefs (`/torneos/copa-semanal-las-1/inscribir` for an open tournament).
  - `profile.test.ts`: a player on a team with a confirmed registration → `teams: [{ name, tag, slug }]` and one tournament entry.
  - `e2e/landing.spec.ts`: seed a `registration_open` tournament (goal 300000, split `[100]`, fee 5000, start 2026-11-07T21:00Z, max-rank rule DIAMOND IV); keep the Plan 2 assertions (`$300.000`, `SÁB 7/11`, `18:00`, `Diamante`, the four fact labels, `el pozo es el premio`), plus the status tag `Inscripción abierta`; with no tournament seeded the page returns 200 and contains `t("cup.none.title")`; a linked player's CTA links to `/torneos/copa-semanal-las-1/inscribir`.
  - `e2e/profile.spec.ts`: the seeded player's team name appears as a link to `/equipos/<slug>`.
- [ ] **Step 2:** Run `bun test` and `bunx playwright test e2e/landing.spec.ts e2e/profile.spec.ts` → FAIL.
- [ ] **Step 3:** Implement; delete the placeholder config.
- [ ] **Step 4:** Run `bun test` and `bunx playwright test` → PASS. Screenshot `/` at 360, 768 and 1280 with a seeded tournament.
- [ ] **Step 5: Commit** `feat: drive landing page and profiles from tournament data`

---

## Done when

`bun test` and `bunx playwright test` pass; an admin can create a tournament, open registration, mark payments and close or cancel it; a player can create a team, invite and accept teammates, and register a roster that is checked against frozen rank snapshots; teams confirm at 5 paid within the cap, waitlist beyond it, and stranded payments become credits exactly once; `/`, `/torneos/<slug>`, `/equipos/<slug>` and profiles show real data, server-rendered, with no horizontal scroll from 320px up.
