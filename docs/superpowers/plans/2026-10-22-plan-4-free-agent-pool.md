# Plan 4: Free-Agent Pool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Solo players who have paid the entry fee enter a tournament's pool with ordered role preferences and get onto a team three ways: they ask a team that is missing players, a captain recruits them, or the system forms teams from the remaining auto-place players when registration closes. Unplaced players get an entry credit.

**Architecture:** A pool entry is a per-tournament row that never stores "placed": a player is *available* when their entry is active, they have a live payment (or the fee is 0) and they are on no active roster, so every path that puts someone on a roster (including a captain adding a team member) removes them from the pool with no sync code. Pool requests reuse `team_requests` (new nullable `tournament_id`) and are accepted through `updateRoster`, so eligibility, snapshots, locking and confirmation stay in the Plan 3 code paths. Auto-placement is a pure planner in `src/shared/` plus a server step that runs inside `closeRegistration`'s transaction, before stranded payments become credits; the auto-formed registrations are confirmed by the existing `recomputeConfirmations`.

**Tech Stack:** Existing stack (Bun, TanStack Start, React 19, Drizzle/Postgres, pg-boss, Zod, Tailwind v4 + Plan 2 components). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-gorosei-mvp-design.md` §5.5 (plus §5.3 payment, §5.4 eligibility applied to the pool). **Roadmap:** `docs/superpowers/plans/2026-10-21-gorosei-roadmap.md`. **Design system:** `DESIGN.md`, `PRODUCT.md`. **Builds on:** `docs/superpowers/plans/2026-10-21-plan-3-tournaments-teams-registration.md` (completed).

## Global Constraints

- A solo player enters a tournament's pool by **paying the entry fee individually before entering** (an admin marks it paid, Plan 3 `markPaid` / `applyCredit`). Free tournaments (`entryFeeArs: 0`) need no payment.
- Roles are top / jungle / mid / bot / support, listed in preference order.
- Three ways onto a team: (1) hand-pick a team missing players → join request → captain accepts or declines; (2) captains browse the pool (filter by role, rank) and send invites; (3) **auto-place when registration closes**: 5-player teams from the remaining auto-place players, balancing roles, **guaranteeing each team passes the tournament's eligibility rules**; the **highest-ranked player becomes captain**.
- A free agent's prior individual payment counts toward whichever team they join (payments are per tournament and player, Plan 3).
- The same eligibility engine filters the pool: players only see teams they are eligible for, and **invites that would break a team's eligibility cannot be accepted**.
- Unplaced players receive an **entry credit** (admin-managed record, no money moves). A team that withdraws or forfeits gets no credit (unchanged from Plan 3).
- Eligibility uses a rank snapshot taken at the moment a player joins a roster; later rank polling never knocks out a registration (Plan 3).
- LAS only; no region filter anywhere. Verified Riot account required to enter the pool.
- Every mutation and every pool entry, removal, placement and credit writes `writeAudit` in the same transaction.
- Every user-facing string goes through `t()` (es-AR, "vos" forms). Store UTC, display `America/Argentina/Buenos_Aires`.
- Public pages stay server-rendered and readable without JavaScript; the pool page is signed-in only.
- UI follows `DESIGN.md`: signal red only for the status tag and the one primary action per screen. Impeccable bans apply: no card grids, gradient text, glassmorphism, side-stripe borders, an eyebrow above every section, or radius > 16px.
- Domain functions never throw for expected failures; they return a typed reason, and each reason has an i18n message (`pool.error.<reason>`).

## Review Focus

1. **A pool player's payment disappears** (admin unmarks it, or their confirmed team withdrew and forfeited it) — they are not listed to captains, not auto-placed, and cannot accept an invite into a roster that then can't confirm. → Task 1, 2 and 5 tests.
2. **Pool sizes that don't divide by 5** (0, 4, 13, 14) — 13 → 2 teams + 3 credits (the spec's example); 0 or 4 → no teams, no errors. → Task 4 and 5 tests.
3. **Two captains invite the same player and both invites are accepted** — the second acceptance fails with `player_already_registered` and the player does not join the second team. → Task 3 test.
4. **Everyone lists the same role, or the rules are only satisfiable by some players** — role preference is soft (teams still form with five distinct assigned roles); a rules-infeasible mix yields fewer teams, never a team that fails the rules. → Task 4 tests.
5. **Close runs twice, or the cap is already full** — no duplicate auto teams or credits; with no free cap slot no auto teams form and every pool player is credited. → Task 5 tests.

## Builder's calls (made here, not confirmed by the owner)

- **Pool is for starter slots only:** requests, invites and auto-placement fill starters (a team needs 5); the pool never fills subs.
- **Pool entry is checked against per-player rules only** (`player_rank_range`, `account_minimums`). Team-level rules can't be judged for one player; they are checked when the player is added to a roster, and by the planner.
- **Entering requires** `registration_open`, a verified Riot account, a live payment (or fee 0), and not being on an active roster of the tournament. Leaving is allowed only while registration is open and never forfeits the payment (it becomes a credit at close if unused).
- **Auto-place is an opt-out flag** (`autoPlace`, default true). Players who opt out stay available to requests and invites; if still unplaced at close they get a credit.
- **Auto-placement uses stored ranks, no Riot call:** it runs inside the close transaction; the six-hourly rank poll keeps stored data fresh. The snapshot is taken at close.
- **Planner (deterministic, no randomness):** teams = `min(floor(candidates / 5), free cap slots)`, free cap slots = `teamCap` − confirmed teams. For k from that maximum down to 1, take the first 5k candidates by pool join time (a second attempt takes the lowest-ranked first when the first fails), snake-distribute by rank to balance averages, then improve by pairwise swaps between teams on the lexicographic objective (rule failures, total role cost, rank-average spread); role cost is the index of the assigned role in the player's preference list (5 when not listed), and each team's roles are assigned by trying all 120 permutations. The first k whose teams all pass the rules wins. Players left out are unplaced. It can leave placeable players out when the mix is awkward; they get credits and an admin can hand-fix.
- **Auto-formed teams** are normal `teams` rows named "Agentes libres <edition>-<n>" with tag "AL" + a base-36 counter, flagged with `auto_formed_tournament_id`. Their captain renames them with `renameTeam` (which clears the flag): that is "keep the team". Disbanding unkept teams after the tournament waits for Plan 5/6, when a finished state exists.
- **Notification** (spec §5.5, §5.12) is the in-page status on the pool page and tournament page; real notifications are Plan 7.
- **Pool visibility:** counts are public; the list of players is shown only to signed-in captains of registered teams missing players.

---

## File Structure

```
src/shared/pool.ts                    ROLES, Role, poolEntryInputSchema
src/shared/auto-place.ts              planAutoPlacement (pure)
src/shared/eligibility.ts             + evaluatePlayerRules
src/server/db/schema/competition.ts   + pool_entries; team_requests.tournament_id; teams.auto_formed_tournament_id; credit reason "unplaced"
src/server/pool/pool.ts               enterPool, leavePool, getPoolEntry, listPool, countPool, removeFromPool
src/server/pool/requests.ts           listOpenTeams, requestFromPool, recruitFromPool, respondToPoolRequest
src/server/pool/auto-place.ts         planPoolPlacement, autoPlacePool
src/server/pool/pool-view.ts          getPoolPage read model
src/server/pool/pool.functions.ts     server functions for the pool page and admin
src/server/tournaments/registrations.ts   updateRoster hooks, snapshotFromStored, exemptRuleIdsFor exported
src/server/tournaments/credits.ts     closeRegistration runs auto-placement; "unplaced" credit reason
src/server/teams/teams.ts             renameTeam, createTeamRow, respondToRequest guard, request lists carry tournamentId
src/routes/torneos.$slug_.agentes-libres.tsx, src/components/pool/*
tests/shared/{pool,auto-place}.test.ts, tests/shared/eligibility.test.ts
tests/server/pool/{pool,requests,auto-place}.test.ts
e2e/free-agents.spec.ts
```

---

### Task 1: Pool entry

**Files:**
- Create: `src/shared/pool.ts`, `src/server/pool/pool.ts`
- Modify: `src/shared/eligibility.ts`, `src/server/db/schema/competition.ts` (add `pool_entries`), `src/server/db/schema/index.ts` if tables are re-exported there, `src/shared/i18n/es-AR.ts`, `tests/helpers/competition.ts`, migration via `bun run db:generate`
- Test: `tests/shared/pool.test.ts`, `tests/shared/eligibility.test.ts`, `tests/server/pool/pool.test.ts`

**Interfaces:**
- Consumes: `takePlayerSnapshot`, `RegistrationDeps` (`registrations.ts`); `paidUserIds`, `lockTournament` (`confirmations.ts`); `EligibilityRule`, `PlayerSnapshot`, `EligibilityFailure`; `writeAudit`.
- Produces:
  ```ts
  // src/shared/pool.ts
  const ROLES = ["top", "jungle", "mid", "bot", "support"] as const;  type Role = (typeof ROLES)[number];
  const poolEntryInputSchema: z.ZodType<{ roles: Role[]; autoPlace: boolean }>;  // 1–5 distinct roles, autoPlace defaults true
  // src/shared/eligibility.ts
  evaluatePlayerRules(rules: EligibilityRule[], player: PlayerSnapshot): EligibilityFailure[];
    // evaluates only per-player rule types (player_rank_range, account_minimums); [] = passes
  // schema pool_entries: tournament_id, user_id (PK together), riot_account_id, roles jsonb Role[], auto_place boolean,
  //   snapshot jsonb PlayerSnapshot, active boolean, joined_at timestamptz
  // src/server/pool/pool.ts
  type PoolEntry = typeof poolEntries.$inferSelect;
  type PoolRejection = "registration_closed" | "riot_required" | "not_paid" | "already_on_roster" | "ineligible" | "invalid_roles" | "not_in_pool";
  enterPool(deps: RegistrationDeps, userId: string, tournamentId: string, input: { roles: Role[]; autoPlace: boolean }):
    Promise<{ ok: true } | { ok: false; reason: PoolRejection; failures?: EligibilityFailure[] }>;
    // upsert: re-entering or editing keeps joined_at of an active entry, refreshes roles/autoPlace/snapshot
  leavePool(db: Db, userId: string, tournamentId: string): Promise<{ ok: true } | { ok: false; reason: "registration_closed" | "not_in_pool" }>;
  getPoolEntry(db: Executor, tournamentId: string, userId: string): Promise<PoolEntry | null>;
  countPool(db: Executor, tournamentId: string): Promise<number>;  // available players (definition below)
  availablePoolQuery(...)  // internal: active entry ∧ live payment or fee 0 ∧ no active registration_players row
  ```
  Test helper: `payFor(tournamentId: string, userId: string): Promise<void>` inserts a live `entry_payments` row; `poolPlayer(tournament, id, rank?, roles?)` links a player, pays and enters the pool.

- [ ] **Step 1: Write the failing tests:**
  - `pool.test.ts` (shared): `poolEntryInputSchema` rejects `[]`, duplicates and an unknown role; accepts `["mid","top"]` and defaults `autoPlace` to `true`.
  - `eligibility.test.ts`: `evaluatePlayerRules ignores team rules` — a `team_average_max` and a `point_budget` rule that a solo MASTER would break return `[]`; a `player_rank_range` max DIAMOND IV rule returns the `eligibility.fail.rank_above` failure for a MASTER and `[]` for a DIAMOND IV; `account_minimums` fails a level-10 player with `minLevel: 30`.
  - `pool/pool.test.ts`: `entering requires an open registration` → `registration_closed` for `registration_closed`; `entering requires a linked Riot account` → `riot_required`; `entering requires a live payment` → `not_paid`, and succeeds after `payFor`; a free tournament needs none; a forfeited payment → `not_paid`; `entering is blocked for a player on an active roster` → `already_on_roster`; `a player who breaks a per-player rule is rejected` with failures; `re-entering keeps joined_at and updates roles`; `leaving requires an open registration`; `countPool counts only paid, active, unrostered entries` (an unmarked payment and a rostered player drop out; asserts `countPool` goes 3 → 2 → 1).
- [ ] **Step 2:** Run `bun test tests/shared tests/server/pool` → FAIL (modules missing).
- [ ] **Step 3: Implement** the schema (one migration), `poolEntryInputSchema`, `evaluatePlayerRules` (filters to per-player rule types and delegates to the existing player-rule code), and `enterPool` / `leavePool` / `getPoolEntry` / `countPool`. `enterPool` takes the snapshot with `takePlayerSnapshot` outside the transaction, then locks the tournament and re-checks status, payment and roster inside it. Audit `pool.entered` / `pool.left`. i18n `pool.error.<reason>` for every reason.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add free-agent pool entry`

### Task 2: Pool listings, join requests and recruiting

**Files:**
- Create: `src/server/pool/requests.ts`
- Modify: `src/server/pool/pool.ts` (add `listPool`), `src/server/db/schema/competition.ts` (`team_requests.tournament_id uuid null → tournaments.id`), `src/server/tournaments/registrations.ts` (export `exemptRuleIdsFor`), `src/server/teams/teams.ts` (`TeamRequest.tournamentId`; request lists carry it), `src/shared/i18n/es-AR.ts`, migration
- Test: `tests/server/pool/requests.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PoolEntry`, `getPoolEntry`, available query), `evaluateRegistration`, `exemptRuleIdsFor`, `teamRequests`, `registrations`, `registrationPlayers`.
- Produces:
  ```ts
  type PoolFilter = { role?: Role; minRank?: Rank; maxRank?: Rank };
  type PoolListing = { userId: string; riotId: string; rank: Rank | null; roles: Role[]; level: number; joinedAt: Date };
  listPool(db: Db, tournamentId: string, filter?: PoolFilter): Promise<PoolListing[]>;
    // available players only; ordered by rank desc then joinedAt; role filter matches any listed role
  type OpenTeam = { registrationId: string; teamSlug: string; teamName: string; tag: string; captainRiotId: string; starterCount: number; paidCount: number };
  listOpenTeams(db: Db, tournamentId: string, userId: string): Promise<OpenTeam[]>;
    // registrations in pending status with < 5 starters on which the viewer (as a starter, using their pool snapshot) passes evaluateRegistration with the team's exceptions
  type RequestRejection = "closed" | "not_in_pool" | "not_captain" | "team_not_registered" | "roster_full" | "already_member" | "already_pending" | "ineligible";
  requestFromPool(db: Db, userId: string, registrationId: string): Promise<{ ok: true; requestId: string } | { ok: false; reason: RequestRejection; failures?: EligibilityFailure[] }>;
    // inserts a team_requests join_request with tournamentId
  recruitFromPool(db: Db, captainId: string, registrationId: string, userId: string): Promise<same>;
    // inserts a team_requests invite with tournamentId
  ```
  Both reject when the registration is not `pending` (a confirmed or waitlisted team can't be missing starters) via `roster_full`/`team_not_registered`; `closed` means the tournament is not `registration_open`.

- [ ] **Step 1: Write the failing tests** (`requests.test.ts`, 10-player fixture helpers from Task 1):
  - `listPool returns only available players` — unpaid, rostered and left players are absent (Review Focus 1); `filters by role and rank` (role `"jungle"`; `minRank` GOLD IV).
  - `listOpenTeams hides teams the player would break`: rules `max_players_above` count 1 above EMERALD I; a team already holding one DIAMOND starter is absent for a DIAMOND player and present for a GOLD one; a team with 5 starters is absent.
  - `requestFromPool creates a join request with the tournament id; twice → already_pending; not in pool → not_in_pool; a full roster → roster_full`.
  - `recruitFromPool is captain-only (not_captain); refuses a player who is not available (not_in_pool); refuses an invite that would break eligibility with the failures (ineligible); refuses an existing team member (already_member)`.
- [ ] **Step 2:** Run `bun test tests/server/pool/requests.test.ts` → FAIL.
- [ ] **Step 3: Implement** the signatures above. Fit check shared by `listOpenTeams`, `requestFromPool` and `recruitFromPool`: current starters' snapshots + the candidate as a starter through `evaluateRegistration(tournament, roster, await exemptRuleIdsFor(db, tournamentId, teamId))`. Pool snapshots are used here (no Riot call).
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add pool listings, join requests and recruiting`

### Task 3: Accepting a pool request places the player

**Files:**
- Modify: `src/server/tournaments/registrations.ts` (`updateRoster` hooks), `src/server/teams/teams.ts` (`respondToRequest` guard), `src/server/pool/requests.ts`, `src/shared/i18n/es-AR.ts`
- Test: `tests/server/pool/requests.test.ts`, `tests/server/tournaments/registrations.test.ts`

**Interfaces:**
- Consumes: Task 2, `updateRoster`, `RegistrationDeps`, `RosterResult`.
- Produces:
  ```ts
  // registrations.ts — existing signature extended; behavior unchanged without hooks
  type RosterHooks = { joining?: string[]; inTransaction?: (tx: Executor) => Promise<void> };
  updateRoster(deps, captainId, registrationId, roster, hooks?: RosterHooks): Promise<RosterResult>;
    // `joining` user ids are treated as team members by the pre-check; `inTransaction` runs after the team, tournament
    // and registration locks and before the membership re-check, and must insert the `team_members` rows for `joining`
  // requests.ts
  respondToPoolRequest(deps: RegistrationDeps, actorId: string, requestId: string, accept: boolean):
    Promise<{ ok: true } | { ok: false; reason: "not_allowed" | "not_pending" | "closed" | "not_in_pool" | "roster_full" | "player_already_registered" | "ineligible"; failures?: EligibilityFailure[] }>;
    // invites are answered by the invited player, join requests by the captain (as respondToRequest); declining just resolves the request
  // teams.ts
  respondToRequest: returns { ok: false; reason: "pool_request" } for any request whose tournamentId is set
  ```
  Accepting: adds the player to `team_members`, appends them to the registration's starters (`updateRoster` called with `team.captainUserId` as the acting captain, `joining: [userId]`), marks the request accepted, and cancels the player's other pending pool requests in that tournament, all in one transaction with audit `pool.placed` (`data: { via: "request" | "invite", requestId }`). Any rejection leaves membership, roster and request unchanged.

- [ ] **Step 1: Write the failing tests:**
  - `registrations.test.ts`: `updateRoster hooks run in the same transaction` — a hook that inserts a `team_members` row for `joining` is rolled back when the roster is ineligible (`ineligible`, no membership row); without hooks every existing test still passes.
  - `requests.test.ts`: `accepting a join request puts the player on the team and the roster` (member row, starter in `registration_players` with a fresh snapshot, `countPool` drops by one); `accepting an invite is done by the invited player, and the roster is updated as the team's captain`; `their other pending requests are cancelled`; `a prior payment counts: the 5th paid starter confirms the team` (team with 4 paid starters + a pool player paid → `confirmed`); `declining leaves everything unchanged`; `an invite that became ineligible cannot be accepted` (a second DIAMOND joined meanwhile → `ineligible`, player not a member); `roster_full` when the team reached 5; **race (Review Focus 3):** two captains invite one player, the first accept succeeds, the second returns `player_already_registered` and the second team has no membership row; the generic `respondToRequest` on a pool request → `pool_request`; a payment unmarked between request and accept → `not_in_pool`.
- [ ] **Step 2:** Run `bun test tests/server` → FAIL.
- [ ] **Step 3: Implement.** Refactor `updateRoster`'s body only as far as needed to thread `hooks`; do not duplicate its validation. In `respondToPoolRequest`, build the new roster as the registration's current starters + the player (subs unchanged).
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: place free agents through pool requests and invites`

### Task 4: Auto-placement planner (pure)

**Files:**
- Create: `src/shared/auto-place.ts`
- Test: `tests/shared/auto-place.test.ts`

**Interfaces:**
- Consumes: `evaluateEligibility`, `EligibilityRule`, `PlayerSnapshot`; `rankValue`; `Role`, `ROLES` (Task 1).
- Produces:
  ```ts
  type PoolCandidate = { snapshot: PlayerSnapshot; roles: Role[]; joinedAt: Date };
  type PlannedTeam = { captainUserId: string; members: { userId: string; role: Role }[] };  // exactly 5 members, 5 distinct roles
  planAutoPlacement(candidates: PoolCandidate[], options: { rules: EligibilityRule[]; maxTeams: number }):
    { teams: PlannedTeam[]; unplacedUserIds: string[] };
  ```
  Algorithm exactly as in "Builder's calls → Planner". Captain = highest `rankValue` (unranked = 0) on the team; ties go to the earlier `joinedAt`, then `userId`. Evaluate rules with `{ subsCountForTeamRules: false, exemptRuleIds: [] }`. Pure and deterministic: the same input gives the same output.

- [ ] **Step 1: Write the failing tests** (`cand(id, rank, roles, joinedAtOffset)` helper):
  - `13 candidates make 2 teams; the 3 latest joiners are unplaced` (Review Focus 2); `4 candidates → no teams, all unplaced`; `0 candidates → empty`; `maxTeams caps the result` (10 candidates, `maxTeams: 1` → one team, 5 unplaced; `maxTeams: 0` → none).
  - `each team has five distinct assigned roles; preferences are honored when possible` — 10 players, two preferring each role first → every player gets their first choice.
  - `everyone listing only mid still forms two teams with distinct roles` (Review Focus 4).
  - `the highest-ranked player is captain; ties go to the earliest joiner`.
  - `ranks are balanced across teams`: 4 DIAMOND + 6 GOLD with `max_players_above` count 2 above EMERALD I → 2 teams, two DIAMOND each; all teams satisfy `evaluateEligibility(...) === []`.
  - `never returns a team that fails the rules`: 5 MASTER (joined first) + 5 GOLD with `max_players_above` count 0 above GOLD I → exactly one team of the 5 GOLD (second selection attempt), 5 MASTER unplaced; with 10 MASTER → no teams.
  - `is deterministic`: shuffled input order gives the same teams.
- [ ] **Step 2:** Run `bun test tests/shared/auto-place.test.ts` → FAIL.
- [ ] **Step 3: Implement** `planAutoPlacement` per the algorithm; keep helpers (`snakeDistribute`, `assignRoles`, `objective`) private.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add auto-placement planner`

### Task 5: Auto-placement at registration close

**Files:**
- Create: `src/server/pool/auto-place.ts`
- Modify: `src/server/tournaments/credits.ts` (`closeRegistration`, credit reason), `src/server/tournaments/registrations.ts` (`snapshotFromStored`), `src/server/teams/teams.ts` (`createTeamRow`, `renameTeam`), `src/server/db/schema/competition.ts` (`teams.auto_formed_tournament_id`, credit reason `"unplaced"`), `src/shared/i18n/es-AR.ts` (`admin.player.credit.reason.unplaced`, `team.error.*`), migration
- Test: `tests/server/pool/auto-place.test.ts`, `tests/server/tournaments/credits.test.ts`, `tests/server/teams/teams.test.ts`

**Interfaces:**
- Consumes: `planAutoPlacement` (Task 4), pool queries (Task 1), `recomputeConfirmations`, `lockTournament`, `closeRegistration`.
- Produces:
  ```ts
  // registrations.ts
  snapshotFromStored(db: Executor, userId: string, rankSource: RankSource, now: Date): Promise<{ riotAccountId: string; snapshot: PlayerSnapshot } | null>;
    // the stored-data half of snapshotWithAccount (no Riot call); snapshotWithAccount refreshes first, then calls it
  // pool/auto-place.ts
  type PoolPlan = { plan: ReturnType<typeof planAutoPlacement>; riotIds: Map<string, string>; failing: string[] };
  planPoolPlacement(db: Executor, tournament: Tournament, now: Date): Promise<PoolPlan>;
    // candidates = available entries with autoPlace, fresh stored snapshots, minus players who now fail per-player rules (listed in `failing`);
    // maxTeams = teamCap − confirmed registrations
  autoPlacePool(tx: Executor, tournament: Tournament, now: Date): Promise<{ teams: number; placed: number }>;
    // creates, per planned team: an auto-formed team (captain + 4 members), a pending registration, registration_players with the snapshots; audit pool.auto_placed
  // teams.ts
  createTeamRow(tx: Executor, input: { name: string; tag: string; captainUserId: string; autoFormedTournamentId?: string }): Promise<{ id: string; slug: string }>;
  renameTeam(db: Db, captainId: string, teamId: string, input: { name: string; tag: string }):
    Promise<{ ok: true } | { ok: false; reason: "not_captain" | "invalid_name" | "invalid_tag" | "name_taken" | "tag_taken" }>;  // same validation as createTeam; clears auto_formed_tournament_id; audit team.renamed
  ```
  `closeRegistration` (same signature) calls `autoPlacePool` then `recomputeConfirmations` right after the status check and before reading rosters; the credit loop uses reason `"unplaced"` for a player with a `pool_entries` row (active or not) who is on no roster, as before `"unconfirmed"`/`"waitlisted"` for the rest.

- [ ] **Step 1: Write the failing tests:**
  - `auto-place.test.ts` (10 paid pool players, GOLD ranks): `planPoolPlacement ignores unpaid, opted-out, rostered and rule-breaking players` (listed in `failing` for the last); `autoPlacePool creates teams named "Agentes libres <edition>-<n>" with the highest-ranked player as captain and every member on the roster`.
  - `credits.test.ts` via `closeRegistration`: `13 paid pool players → 2 confirmed auto teams and 3 credits with reason unplaced` (Review Focus 2); `4 pool players → no teams, 4 credits`; `a pool payment unmarked before close is not placed and gets no credit` (Review Focus 1); `a forfeited payment is not placed`; `with the cap already full no auto team forms and every pool player is credited` (Review Focus 5); `closing twice creates no second set of teams or credits` (second call `invalid_state`, team and credit counts unchanged); `players who opted out of auto-place are credited when unplaced`; `a free tournament auto-places with no payments`; `auto teams do not exceed the free cap slots` (cap 3, 2 confirmed, 10 players → 1 team).
  - `teams.test.ts`: `renameTeam validates like createTeam, is captain-only, and keeps an auto-formed team (flag cleared)`.
- [ ] **Step 2:** Run `bun test tests/server` → FAIL.
- [ ] **Step 3: Implement.** `autoPlacePool` and `planPoolPlacement` share `planPoolPlacement`. Auto team tag: "AL" + the first unused base-36 counter (2–5 chars total); names resolve collisions by appending `-<n>`.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: auto-place free agents at registration close`

### Task 6: Pool page and tournament page entry points

**Files:**
- Create: `src/server/pool/pool-view.ts`, `src/server/pool/pool.functions.ts`, `src/routes/torneos.$slug_.agentes-libres.tsx`, `src/components/pool/{role-picker,pool-table,open-teams}.tsx`
- Modify: `src/routes/torneos.$slug.tsx` (pool count + secondary "Buscar equipo" link while registration is open), `src/server/tournaments/tournament-view.ts` (`poolCount`), `src/routes/mis-equipos.tsx` and `src/routes/equipos.$slug.tsx` (pool-labelled requests via `respondToPoolRequest`; captain rename/"Quedarse con el equipo" form for auto-formed teams), `src/shared/i18n/es-AR.ts`, `e2e/public-routes.ts`
- Test: `tests/server/pool/pool.test.ts` (read model), `e2e/free-agents.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  ```ts
  type PoolPage = {
    tournament: { slug; title; edition; status; entryFeeArs; paymentInstructions; poolCount: number };
    viewer:
      | { kind: "signed_out" } | { kind: "no_riot" }
      | { kind: "unpaid" }                                       // can't enter yet; show how to pay
      | { kind: "ineligible"; failures: EligibilityFailure[] }
      | { kind: "can_enter" }
      | { kind: "in_pool"; entry: { roles: Role[]; autoPlace: boolean }; openTeams: OpenTeam[]; invites: { requestId; teamName }[]; requests: { requestId; teamName }[] }
      | { kind: "placed"; team: { name; slug; captainRiotId; mates: string[]; autoFormed: boolean } }
      | { kind: "unplaced"; creditGranted: boolean };            // after close
    captain: { registrationId: string; teamName: string; missing: number; pool: PoolListing[] } | null;  // only for captains of a pending registration with < 5 starters
  };
  getPoolPage(db: Db, slug: string, viewerId: string | null, filter?: PoolFilter): Promise<PoolPage | null>;
  ```
  Server functions: `getPoolPageFn`, `enterPoolFn`, `leavePoolFn`, `requestFromPoolFn`, `recruitFromPoolFn`, `respondToPoolRequestFn`, `renameTeamFn`. The route is signed-in; the tournament page stays public and shows the count (omitted when 0) and the link. The role picker is five numbered toggle buttons (click order = preference) with a hidden input fallback; the pool list and open teams are tables. Failures render `formatFailure` messages in a `role="alert"` list.

- [ ] **Step 1: Write the failing tests:**
  - `pool.test.ts`: `getPoolPage reports each viewer state` — signed out, no Riot, unpaid, ineligible (failures), can_enter, in_pool (with `openTeams`), placed (after a join), and after `closeRegistration` an unplaced paid player → `unplaced` with `creditGranted: true`; `captain is null unless the viewer captains a pending team with < 5 starters`.
  - `e2e/free-agents.spec.ts` (seed a `registration_open` tournament, fee 5000): JS disabled `/torneos/<slug>` shows `3 agentes libres` for 3 pool players and the link `Buscar equipo`; an unpaid player sees the payment instructions and no role picker; after an admin-style payment the player enters with roles Mid, Top and sees a team missing a player; **hand-pick:** the player requests, the captain accepts on `/mis-equipos`, and the team page lists the player; **recruit:** a captain filters the pool by role, invites, the player accepts from the pool page; a MASTER cannot be invited into a team whose rules forbid it (alert shows the failure); the page has no horizontal scroll at 320px. Add the pool page to the authenticated-route checks.
- [ ] **Step 2:** Run `bun test tests/server/pool` and `bunx playwright test e2e/free-agents.spec.ts` → FAIL.
- [ ] **Step 3: Implement.** Read model first, then functions, then UI. Copy in Spanish via `t()`; the warning that entering requires the individual payment sits next to the payment instructions.
- [ ] **Step 4:** Run `bun test` and `bunx playwright test` → PASS. Screenshot the pool page for each viewer state at 360 and 1280.
- [ ] **Step 5: Commit** `feat: add free-agent pool page`

### Task 7: Admin pool tools

**Files:**
- Modify: `src/server/pool/pool.ts` (`removeFromPool`, `listPoolForAdmin`), `src/server/pool/pool.functions.ts`, `src/routes/admin.torneos.$id.tsx`, `src/components/pool/pool-table.tsx`, `src/shared/i18n/es-AR.ts`
- Create: `src/components/tournament/admin-pool.tsx`
- Test: `tests/server/pool/pool.test.ts`, `e2e/free-agents.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 5 (`planPoolPlacement`), `requireAdmin` (existing in `admin.functions.ts`; reuse, do not duplicate).
- Produces:
  ```ts
  removeFromPool(db: Db, adminId: string, tournamentId: string, userId: string, reason: string): Promise<{ ok: true } | { ok: false; reason: "not_in_pool" }>;  // sets active=false; audit pool.removed with reason; payment untouched
  type AdminPoolRow = { userId: string; riotId: string; rank: Rank | null; roles: Role[]; autoPlace: boolean; paid: boolean; state: "available" | "on_roster" | "left" };
  listPoolForAdmin(db: Db, tournamentId: string): Promise<AdminPoolRow[]>;  // every entry, paid or not
  ```
  `/admin/torneos/$id` gains a pool section: the table, a "Quitar del pool" action with a required reason, and a **"Vista previa del armado"** button listing the teams `planPoolPlacement` would form now (members with assigned roles, captain, unplaced players, players failing rules) with the line that it runs automatically at close and that "Cerrar inscripción ahora" runs it.

- [ ] **Step 1: Write the failing tests:**
  - `pool.test.ts`: `removeFromPool deactivates the entry, keeps the payment and audits the reason`; `listPoolForAdmin includes unpaid and rostered entries with their state`.
  - `e2e/free-agents.spec.ts`: an admin sees 10 pool rows, previews 2 teams, closes registration, and the tournament page then lists two confirmed "Agentes libres" teams; a pool player's pool page shows `placed` with teammates; the captain renames the team from the team page and the new name appears on the tournament page; a non-admin still gets 404 on the admin page.
- [ ] **Step 2:** Run `bun test tests/server/pool` and `bunx playwright test e2e/free-agents.spec.ts` → FAIL.
- [ ] **Step 3: Implement.** Admin UI follows Plan 3's admin style (dense tables, no cards).
- [ ] **Step 4:** Run `bun test` and `bunx playwright test` → PASS.
- [ ] **Step 5: Commit** `feat: add admin free-agent pool tools`

---

## Done when

`bun test` and `bunx playwright test` pass; a paid solo player can enter a tournament's pool with ordered roles, ask a team missing players or be recruited by a captain, and only teams and invites that keep the roster eligible are offered or accepted; at registration close the remaining auto-place players are formed into confirmed teams (balanced roles and ranks, highest-ranked as captain, every team passing the rules) within the free cap slots, anyone left over gets exactly one `unplaced` credit, and running close twice changes nothing; admins can see the pool, preview the placement and remove players; the pool page shows each player their status; and all new public pages stay server-rendered with no horizontal scroll from 320px up.
