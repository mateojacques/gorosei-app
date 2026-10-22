# Plan 7: Automation & Notifications — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the weekly cup with no manual setup (recurring templates that create and open each edition), tell players about the moments that matter (in-app plus email), and add the Riot-approved paths (Riot Sign On, tournament codes, result callbacks) behind per-capability flags that change nothing while they are off.

**Architecture:** Templates are rows copied into a new `tournaments` row by a pg-boss job; the schedule arithmetic is pure (`src/shared/templates.ts`), so catch-up and idempotency are unit-tested. A notification is a row written **in the same transaction** as the change it reports; the same transaction runs `pg_notify`, which Postgres delivers only on commit, so a listener can push a contentless `user:<id>` realtime event and rolled-back work never pings anyone. Email is an outbox: a job claims pending rows and sends them through a small `Mailer` (Resend over HTTP, or a log mailer in development). Riot features are read once from env into `riotFeatures`; each one adds a path next to the fallback and never removes it.

**Tech Stack:** Existing stack (pg-boss, postgres.js `listen`, Better Auth, Hono, Zod). Better Auth's bundled `genericOAuth` plugin for RSO. Email via Resend's HTTP API with `fetch` (no SDK). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-21-gorosei-mvp-design.md` §5.11 (recurring templates), §5.12 (notifications), §5.10 (Riot integration modes), §5.6 (check-in reminder), §2 anti-goal "never a state where no tournament is open or upcoming". **Roadmap:** `docs/superpowers/plans/2026-10-21-gorosei-roadmap.md`. **Design system:** `DESIGN.md`, `PRODUCT.md`. **Builds on:** Plans 1–6 (completed).

## Global Constraints

- Templates hold: format, eligibility rules, rank source, entry fee, prize split, team cap, roster size, best-of settings, rules text, stream channel, and a schedule ("every Saturday 18:00 ART", registration opens N days before). The platform **auto-creates each next edition** (edition number incremented, e.g. "Copa Semanal LAS #13") and **opens registration**. **Editing one edition doesn't change the template**, and editing the template doesn't change editions already created.
- There must never be a state where no tournament is open or upcoming: an active template whose editions are all live, finished or cancelled gets its next edition at once.
- Notifications are in-app plus email for: team invite / join request, payment confirmed, auto-placement result / entry credit, check-in opening, check-in reminder (captain, **15 minutes before the check-in deadline, only if someone is missing**), your match is ready, result confirmed, dispute update. **No WhatsApp or Discord.**
- A notification is written in the same transaction as the change it reports and only when that change happened. Re-running a job or repeating an action never notifies twice (dedupe keys).
- Realtime events carry no private data. `user:<id>` is subscribable only by that signed-in user; the event says "something changed" and the client refetches.
- Riot capabilities switch **per capability** (`rso`, `tournament_codes`, `result_callbacks`), not as a rewrite. All flags off = exactly today's behavior. With codes on, a match whose code could not be issued still gets a moderator lobby. With callbacks on, **a moderator still confirms every result**.
- Fixed Riot values: LAS platform `LA2`, regional routing `americas`, match IDs `LA2_<gameId>`, team size 5, map Summoner's Rift.
- Every user-facing string, including email subjects and bodies, goes through `t()` (es-AR, "vos"). Times shown in `America/Argentina/Buenos_Aires` (fixed UTC−03:00, no DST), stored UTC. Domain functions never throw for expected failures; they return a typed reason.
- Admin and system changes are audit-logged (`actorUserId: null` for jobs). UI follows `DESIGN.md` (signal red only for the status tag and the one primary action per screen; Impeccable bans apply). Phone first: no horizontal page scroll at 320px.
- Tests never call Riot or send email: fakes for Riot, a recording mailer for email.

## Review Focus

1. **Edition creation under concurrency and downtime**: two job runs at the same minute, a server down for three weeks, a template paused and resumed, a weekday/time that crosses the UTC date (Friday 22:30 ART). Expected: exactly one edition per start time, never one whose registration has already closed, never a past start. → Tasks 1, 3.
2. **Side effects of actions that didn't happen**: a rejected invite, a `markPaid` refused with `invalid_state`, an already-paid player, a transaction that rolls back after `notify`, a reminder job re-run. Expected: no row, no realtime ping, no second notification. → Tasks 2, 5, 6.
3. **Email to the wrong, stale or hostile place**: an opted-out player, an RSO account with no real email, a "your match is ready" queued during a three-hour mail outage, Resend answering 429/500/422, a team named `<script>` in the HTML body, two job runs claiming the same rows. Expected: skipped, skipped, skipped as stale, retried/retried/failed, escaped, sent once. → Task 7.
4. **Forged, early or repeated Riot callbacks**: wrong secret, unknown short code, a game whose players are not the two rosters, a callback before match-v5 has the game, the same callback twice, a callback for a completed match. Expected: 404, ignored, no score, retried later, counted once, ignored. → Task 12.
5. **RSO identity collisions**: a player already verified by icon change signs in with Riot (lands in their existing account), a signed-in player links a Riot account owned by someone else (refused), a player already linked to account A links account B (refused), Riot's `accounts/me` failing mid-sign-in (sign-in fails cleanly). → Task 10.

## Builder's calls (made here, not confirmed by the owner)

- **Weekly templates only**, one weekday and start time per template (two cups a week = two templates). Defaults: registration opens **7 days** before (the next edition appears as the previous one starts), closes **120 minutes** before (minimum 60, as `tournamentInputSchema` requires).
- **Editions are created already `registration_open`**; `createdBy` is the template's creator, the audit actor is `null`. Cancelled editions count for "latest start" so a cancelled week isn't re-created.
- **"Payment confirmed"** is two notifications: `payment_recorded` to the player whose payment the admin marked, `registration_confirmed` to the roster when the team reaches confirmed. A join request answered "yes" also tells the requester (`request_accepted`); declines are silent.
- **"Dispute update"** = the match becoming disputed (both captains) and the dispute's resolution, which is the `result_confirmed` notification. Chat messages do not notify.
- **Email for every kind**, with a per-player off switch on `/notificaciones`. Time-bound kinds (`match_ready`, `check_in_open`, `check_in_reminder`) are not emailed more than **1 hour** after they were created; others within 7 days. 3 send attempts.
- **In-app inbox**: newest 50, opening `/notificaciones` marks them read. No push notifications, no digest, no retention job.
- **Riot flags in env** (`RIOT_FEATURES=rso,tournament_codes,result_callbacks`), not admin toggles: each needs credentials that live in env anyway. `result_callbacks` requires `tournament_codes`.
- **RSO accounts get a placeholder email** `<puuid>@riot.invalid` (Better Auth needs one); it is never emailed. With RSO on, email/Discord **sign-up** is closed, sign-in stays for existing accounts.
- **Tournament codes without `allowedParticipants`**: the code is private to the two teams and moderators, and results are verified against the rosters through match-v5 (≥3 players per roster, as Plan 5's stats already require). This keeps codes valid through player swaps.
- **One code per match** (reused for every game of a Bo3/Bo5). A match reset clears it and a new one is issued.
- **Callbacks are hints**: the callback only queues a job; the result comes from match-v5 and pre-fills `riotScore`. Confirming without an explicit score uses `riotScore` when it decides the match, else the captains' reports.

---

## File Structure

```
src/shared/templates.ts                     templateInputSchema, nextOccurrence, planNextEdition, editionInput
src/shared/notifications.ts                 NotificationPayload, notificationText, notificationHref, EMAIL_TTL_MS, NO_EMAIL_DOMAIN
src/shared/tournament.ts                    tournamentFieldsSchema (unrefined base, shared with templates)
src/server/db/schema/notifications.ts       notifications, notificationSettings
src/server/db/schema/competition.ts         tournamentTemplates, tournaments.template_id, tournaments.riot_tournament_id
src/server/db/schema/matchday.ts            matches.tournament_code, matches.riot_score
src/server/notifications/{notify,inbox,listen,recipients,settings}.ts, notifications.functions.ts
src/server/tournaments/templates.ts, templates.functions.ts
src/server/jobs/{create-editions,check-in-reminders,send-emails}.ts, boss.ts
src/server/email/{mailer,render}.ts
src/server/riot/{http,features,tournament-client,callback}.ts, client.ts, types.ts
src/server/identity/rso.ts, src/server/auth.ts, src/auth-client.ts
src/server/matchday/tournament-codes.ts, stats.ts, moderation.ts, reports.ts
src/routes/admin.plantillas.{index,nueva,$id}.tsx, notificaciones.tsx, ingresar.tsx, vincular-riot.tsx
src/components/tournament/{template-form,tournament-fields}.tsx, src/components/site/{inbox-list,inbox-link}.tsx
tests/shared/{templates,notifications}.test.ts, tests/server/{notifications,email,riot,jobs,identity,matchday,tournaments}/*.test.ts
tests/helpers/fake-riot-tournament.ts, tests/helpers/recording-mailer.ts
e2e/admin-templates.spec.ts, e2e/notifications.spec.ts
```

Every task that changes `src/server/db/schema` runs `bun run db:generate` and commits the new file under `drizzle/`.

---

### Task 1: Template schedule rules (pure)

**Files:**
- Create: `src/shared/templates.ts`
- Modify: `src/shared/tournament.ts`, `src/shared/i18n/es-AR.ts`
- Test: `tests/shared/templates.test.ts`

**Interfaces:**
- Consumes: `tournamentInputSchema`, `TournamentInput`.
- Produces:
  ```ts
  // tournament.ts: the object schema before .refine(), so templates can omit fields (Zod 4 refuses .omit on refined objects)
  export const tournamentFieldsSchema: z.ZodObject<...>;   // tournamentInputSchema = tournamentFieldsSchema.refine(...) unchanged
  // templates.ts
  export const templateInputSchema;   // tournamentFieldsSchema.omit({ edition, startsAt, registrationClosesAt }).extend({
                                      //   weekday: int 0..6 (0 = Sunday, ART), startTime: /^([01]\d|2[0-3]):[0-5]\d$/ (ART),
                                      //   registrationOpensDaysBefore: int 1..28 (default 7), registrationClosesMinutesBefore: int 60..10080 (default 120),
                                      //   nextEdition: int ≥ 1, active: boolean })
  export type TemplateInput = z.infer<typeof templateInputSchema>;
  export type TemplateSchedule = Pick<TemplateInput, "weekday" | "startTime" | "registrationOpensDaysBefore" | "registrationClosesMinutesBefore">;
  export function nextOccurrence(t: Pick<TemplateInput, "weekday" | "startTime">, after: Date): Date;   // first instant strictly after `after`
  export type EditionPlan = { startsAt: Date; registrationClosesAt: Date; createAt: Date };
  export function planNextEdition(t: TemplateSchedule, latestStartsAt: Date | null, hasUpcoming: boolean, now: Date): EditionPlan | null;
  export function editionInput(t: TemplateInput, plan: EditionPlan, edition: number): TournamentInput;
  ```

- [ ] **Step 1: Write the failing tests** (`templates.test.ts`, Review Focus 1). Saturday 18:00 ART is `weekday: 6, startTime: "18:00"`.
  - `nextOccurrence` after `2026-10-21T15:00Z` (Wednesday) → `2026-10-24T21:00Z`; after exactly `2026-10-24T21:00Z` → `2026-10-31T21:00Z`; after `2026-10-24T20:59Z` → `2026-10-24T21:00Z`; Friday 22:30 ART (`weekday: 5, "22:30"`) after the same Wednesday → `2026-10-24T01:30Z`; Sunday 00:30 ART → `2026-10-25T03:30Z`.
  - `planNextEdition` (opens 7 days, closes 120 min): no editions, `hasUpcoming: false`, now Wednesday → `startsAt 2026-10-24T21:00Z`, `registrationClosesAt 2026-10-24T19:00Z`. Latest `2026-10-24T21:00Z`, `hasUpcoming: true`, now `2026-10-24T20:59Z` → `null`; now `2026-10-24T21:00Z` → `startsAt 2026-10-31T21:00Z`. No editions, now `2026-10-24T19:30Z` (this Saturday's registration already closed) → `2026-10-31T21:00Z`. Down three weeks: latest `2026-10-03T21:00Z`, `hasUpcoming: false`, now `2026-10-24T15:00Z` → `2026-10-24T21:00Z` (one edition, not three). Latest in the future with `hasUpcoming: false` (cancelled) → the occurrence after it, at once. With `registrationOpensDaysBefore: 2`, latest `2026-10-24T21:00Z` finished and `hasUpcoming: false` → created immediately (the anti-goal wins over the window).
  - `editionInput` copies every template field, keeps the title, sets `edition` and the plan's dates, and the result passes `tournamentInputSchema`.
  - `templateInputSchema` rejects `startTime` `"24:00"` and `"7:05"`, `weekday: 7`, `registrationOpensDaysBefore: 0`, `registrationClosesMinutesBefore: 59`; `tournamentInputSchema` behaves exactly as before (its existing tests still pass).
- [ ] **Step 2:** Run `bun test tests/shared/templates.test.ts` → FAIL.
- [ ] **Step 3: Implement.** ART is a fixed −03:00 offset: shift `after` by −3h, find the next matching UTC weekday/time in the shifted frame, shift back. `planNextEdition`:
  ```
  start = nextOccurrence(t, max(latestStartsAt ?? now, now))
  while start − closesMinutesBefore ≤ now: start += 7 days
  createAt = start − opensDaysBefore days
  return (!hasUpcoming || now ≥ createAt) ? { startsAt: start, registrationClosesAt: start − closesMinutes, createAt } : null
  ```
  Add `template.weekday.0..6` ("Domingo"…"Sábado") strings.
- [ ] **Step 4:** Run `bun test tests/shared` → PASS.
- [ ] **Step 5: Commit** `feat: add recurring template schedule rules`

### Task 2: Notification store, text and realtime ping

**Files:**
- Create: `src/server/db/schema/notifications.ts`, `src/shared/notifications.ts`, `src/server/notifications/{notify,inbox,listen,recipients}.ts`
- Modify: `src/server/db/schema/index.ts`, `src/server/realtime/server.ts` (`canSubscribe`), `src/server/realtime/start.ts`, `src/server/realtime/hub.ts` (channel list comment), `src/shared/i18n/es-AR.ts`
- Test: `tests/shared/notifications.test.ts`, `tests/server/notifications/notify.test.ts`, `tests/server/realtime/server.test.ts`

**Interfaces:**
- Consumes: `Executor`, `publish`, `formatDateTime`.
- Produces:
  ```ts
  // shared/notifications.ts
  type TournamentRef = { title: string; edition: number; slug: string };
  type NotificationPayload =
    | { kind: "team_invite"; teamName: string; tournament: TournamentRef | null }          // tournament set for pool invites
    | { kind: "join_request"; teamName: string; playerRiotId: string; tournament: TournamentRef | null }
    | { kind: "request_accepted"; teamName: string; teamSlug: string }
    | { kind: "payment_recorded"; tournament: TournamentRef }
    | { kind: "registration_confirmed"; teamName: string; tournament: TournamentRef }
    | { kind: "auto_placed"; teamName: string; teamSlug: string; teammates: string[]; captain: boolean; tournament: TournamentRef }
    | { kind: "credit_granted"; reason: "unconfirmed" | "waitlisted" | "unplaced" | "cancelled" | "manual"; tournament: TournamentRef | null }
    | { kind: "check_in_open"; tournament: TournamentRef; closesAt: string }               // ISO
    | { kind: "check_in_reminder"; tournament: TournamentRef; missing: number; closesAt: string }
    | { kind: "match_ready"; tournament: TournamentRef; matchId: string; opponent: string }
    | { kind: "result_confirmed"; tournament: TournamentRef; matchId: string; won: boolean; score: [number, number] }   // own score first
    | { kind: "match_disputed"; tournament: TournamentRef; matchId: string };
  type NotificationKind = NotificationPayload["kind"];
  notificationHref(p: NotificationPayload): string;             // path, never absolute
  notificationText(p: NotificationPayload): { title: string; body: string };
  const EMAIL_TTL_MS: Record<NotificationKind, number>;         // 1h for match_ready, check_in_open, check_in_reminder; 7 days otherwise
  const NO_EMAIL_DOMAIN = "riot.invalid";
  // schema: notifications(id uuid pk, user_id fk, kind, payload jsonb, href, dedupe_key text unique null, created_at, read_at null,
  //   email_status 'pending'|'sending'|'sent'|'failed'|'skipped' default 'pending', email_attempts int default 0, emailed_at null),
  //   index (user_id, created_at), partial index on created_at where email_status = 'pending'
  // notify.ts
  notify(tx: Executor, userIds: string[], payload: NotificationPayload, dedupeKey?: string): Promise<number>;   // rows inserted
  // inbox.ts
  type NotificationView = { id: string; payload: NotificationPayload; href: string; createdAt: Date; read: boolean };
  listNotifications(db: Db, userId: string, limit?: number): Promise<NotificationView[]>;   // newest first, default 50
  countUnread(db: Db, userId: string): Promise<number>;
  markAllRead(db: Db, userId: string, upTo: Date): Promise<void>;   // rows created at or before upTo
  // listen.ts
  listenForNotifications(client: Db["$client"], push?: typeof publish): Promise<() => Promise<void>>;   // publishes { channel: `user:${id}`, type: "notification" }
  // recipients.ts (used by Tasks 5, 6)
  tournamentRef(tx: Executor, tournamentId: string): Promise<TournamentRef>;
  rosterUserIds(tx: Executor, registrationId: string): Promise<string[]>;   // active players, starters and subs
  captainOf(tx: Executor, registrationId: string): Promise<string | null>;
  teamNameOf(tx: Executor, registrationId: string): Promise<string>;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `notifications.test.ts`: one fixture per kind; `notificationText` returns non-empty `title` and `body`, never leaves a `{param}` placeholder, includes the team name or `#<edition>` where the payload has one; `check_in_reminder` with `missing: 1` and `2` reads correctly ("falta 1 jugador" / "faltan 2 jugadores"); `credit_granted` has a distinct body per reason. `notificationHref`: match kinds → `/partidas/<matchId>`; tournament kinds → `/torneos/<slug>`; `team_invite`/`join_request` with a tournament → `/torneos/<slug>/agentes-libres`, without → `/mis-equipos`; `request_accepted`/`auto_placed` → `/equipos/<teamSlug>`.
  - `notify.test.ts` (Review Focus 2): two users → two rows, `["a","a","b"]` → two; the same `dedupeKey` twice → second call returns 0; `notify` inside `testDb.transaction` that then throws → no rows and a `testDb.$client.listen("notifications", …)` listener receives nothing within 500 ms; committed → the listener receives each inserted user id. `listenForNotifications` with a recording `push` publishes `user:<id>`. `markAllRead(upTo)` leaves a newer row unread; `countUnread` counts only the user's own unread rows.
  - `server.test.ts`: `canSubscribe` allows `user:<id>` to that user only; signed out → false; another user → false; `user:` with no id → false.
- [ ] **Step 2:** Run `bun test tests/shared/notifications.test.ts tests/server/notifications tests/server/realtime` → FAIL.
- [ ] **Step 3: Implement.** `notify` inserts with `dedupe_key = ${dedupeKey}:${userId}` (null without a key), `onConflictDoNothing().returning()`, then `select pg_notify('notifications', ${userId})` for each inserted row. `startRealtime` calls `listenForNotifications(db.$client)` once per process. `db:generate` the migration.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add notification store and realtime ping`

### Task 3: Templates and the edition job

**Files:**
- Create: `src/server/tournaments/templates.ts`, `src/server/jobs/create-editions.ts`
- Modify: `src/server/db/schema/competition.ts`, `src/server/tournaments/tournaments.ts` (export `uniqueTournamentSlug`, the current private `uniqueSlug`), `src/server/jobs/boss.ts`
- Test: `tests/server/tournaments/templates.test.ts`, `tests/server/jobs/create-editions.test.ts`

**Interfaces:**
- Consumes: Task 1 (`TemplateInput`, `planNextEdition`, `editionInput`), `writeAudit`.
- Produces:
  ```ts
  // schema: tournament_templates(id uuid pk, title, every TemplateInput field as a column — rules/split jsonb —, created_by fk user,
  //   created_at, updated_at); tournaments.template_id uuid null fk; unique index (template_id, starts_at)
  type Template = typeof tournamentTemplates.$inferSelect;
  createTemplate(db: Db, adminId: string, input: TemplateInput): Promise<{ id: string }>;                          // audit template.created
  updateTemplate(db: Db, adminId: string, id: string, input: TemplateInput): Promise<{ ok: true } | { ok: false; reason: "not_found" }>;  // audit template.updated {before, after}
  getTemplate(db: Db, id: string): Promise<Template | null>;
  type TemplateRow = Template & { next: EditionPlan | null; latest: { slug: string; edition: number; status: TournamentStatus } | null };
  listTemplates(db: Db, now: Date): Promise<TemplateRow[]>;   // `next` = the plan the job would make, ignoring the createAt wait (for display)
  createDueEditions(db: Db, now: Date): Promise<{ created: number }>;
  ```

- [ ] **Step 1: Write the failing tests** (Review Focus 1):
  - `create-editions.test.ts`: an active Saturday template with `nextEdition: 13` and no editions → one tournament `registration_open`, edition 13, slug `copa-semanal-las-13`, `templateId` set, every field copied, `createdBy` = template creator, audit `tournament.created_from_template` with `actorUserId: null`; the template's `nextEdition` becomes 14. A second call at the same `now` → `created: 0`. `Promise.all` of two calls → exactly one tournament. An inactive template → none. Latest edition `registration_open` and `now` before its `createAt` → none; at `createAt` → the next week's edition #14. Three weeks of downtime → one edition, in the future. A template whose only edition is cancelled → the next one at once. One template whose insert throws (stub a bad row) does not stop another template's edition.
  - `templates.test.ts`: `updateTournament` on an edition leaves the template unchanged; `updateTemplate` leaves existing editions unchanged; `updateTemplate` on an unknown id → `not_found`; `listTemplates` shows `latest` and `next`.
- [ ] **Step 2:** Run `bun test tests/server/tournaments/templates.test.ts tests/server/jobs/create-editions.test.ts` → FAIL.
- [ ] **Step 3: Implement.** One transaction per template: lock the template row `FOR UPDATE`, read the latest `starts_at` among its tournaments (any status) and whether any is `registration_open | registration_closed | check_in`, plan, insert, bump `next_edition`. A unique violation on `(template_id, starts_at)` counts as already created. Wrap each template in try/catch and log, like `advanceTournaments`. Register `create-editions` every minute in `registerJobs`. `db:generate`.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: create weekly editions from recurring templates`

### Task 4: Admin template pages

**Files:**
- Create: `src/server/tournaments/templates.functions.ts`, `src/routes/admin.plantillas.index.tsx`, `src/routes/admin.plantillas.nueva.tsx`, `src/routes/admin.plantillas.$id.tsx`, `src/components/tournament/template-form.tsx`, `src/components/tournament/tournament-fields.tsx`, `e2e/admin-templates.spec.ts`
- Modify: `src/components/tournament/tournament-form.tsx` (uses the extracted fields), `src/routes/admin.torneos.index.tsx` (link to templates), `src/shared/i18n/es-AR.ts`

**Interfaces:**
- Consumes: Task 3, `requireAdmin` from `admin.functions.ts`.
- Produces: `listTemplatesFn` (GET), `getTemplateFn` (GET `{ id }`), `createTemplateFn` / `updateTemplateFn` (POST, `{ input: unknown }` parsed by `templateInputSchema`, returning `{ ok: false; reason: "invalid_input"; issues }` like `parseInput` in `admin.functions.ts`). `tournament-fields.tsx` holds the fields both forms share (format, best-of, cap, subs, rank source, rules, fee, prize, payment instructions, rules text, stream URL); `TemplateForm` adds weekday select, start time (ART), opens-days-before, closes-minutes-before, next edition, active.
- The list is rows (not cards): title, "Sábado 18:00 ART", next edition "#13 · sáb 24 oct 18:00" or "Pausada", last edition linked to its admin page.

- [ ] **Step 1: Write the failing e2e** `admin-templates.spec.ts` (JavaScript enabled): an admin creates "Copa Semanal LAS", Saturday 18:00, next edition 13 → the list shows it with "#13" and the next Saturday's date; editing it to inactive shows "Pausada"; an invalid start time shows the field error; a player gets the not-found page at `/admin/plantillas`; 320 px has no horizontal scroll. The existing `admin-tournaments.spec.ts` still passes (shared fields extraction).
- [ ] **Step 2:** Run `bun run test:e2e -- admin-templates` → FAIL.
- [ ] **Step 3: Implement** the server functions, routes and forms.
- [ ] **Step 4:** Run `bun run typecheck` → clean; `bun run test:e2e -- admin-templates admin-tournaments` → PASS.
- [ ] **Step 5: Commit** `feat: add admin pages for recurring templates`

### Task 5: Notifications for teams, pool, payments and credits

**Files:**
- Modify: `src/server/teams/teams.ts`, `src/server/pool/requests.ts`, `src/server/tournaments/confirmations.ts`, `src/server/pool/auto-place.ts`, `src/server/tournaments/credits.ts`
- Test: `tests/server/notifications/registration-triggers.test.ts`

**Interfaces:**
- Consumes: Task 2 (`notify`, `recipients.ts`).
- Produces (each call inside the existing transaction, after the write it reports):
  | Where | To | Payload | Dedupe key |
  |---|---|---|---|
  | `inviteByRiotId` ok | invitee | `team_invite`, `tournament: null` | `invite:<requestId>` |
  | `requestToJoin` ok | captain | `join_request`, `tournament: null` | `request:<requestId>` |
  | `respondToRequest` accepting a join request | requester | `request_accepted` | `accepted:<requestId>` |
  | `insertRequest` (pool) ok | invitee (`invite`) / captain (`join_request`) | `team_invite` / `join_request` with the tournament | `invite:` / `request:<requestId>` |
  | `respondToPoolRequest` accepting a join request (inside `inTransaction`) | requester | `request_accepted` | `accepted:<requestId>` |
  | `markPaid`, each row inserted | that player | `payment_recorded` | `payment:<paymentId>` |
  | `recomputeConfirmations`, a registration becoming `confirmed` | active roster | `registration_confirmed` | `confirmed:<registrationId>` |
  | `autoPlacePool`, each team | each member | `auto_placed` (`captain: true` for the captain, `teammates` as Riot IDs) | `auto_placed:<registrationId>` |
  | `grantCredit` returning true, `grantManualCredit` | the player | `credit_granted` with the reason | `credit:<creditId>` |

- [ ] **Step 1: Write the failing tests** (Review Focus 2): each row of the table produces exactly the listed notification with the listed payload; `inviteByRiotId` → `already_member` writes nothing; declining a request writes nothing; `markPaid` refused with `invalid_state` writes nothing; marking an already-paid player again writes no second `payment_recorded`; `closeRegistration` with 13 pool players (Plan 4 fixtures) → 10 `auto_placed` (one `captain: true` per team) and 3 `credit_granted` with `reason: "unplaced"`; cancelling that tournament afterwards adds `credit_granted` (`cancelled`) only for players who had no credit yet; a confirmed team that drops back to pending and confirms again is notified once.
- [ ] **Step 2:** Run `bun test tests/server/notifications/registration-triggers.test.ts` → FAIL.
- [ ] **Step 3: Implement** the calls from the table. `grantCredit` needs the inserted credit's id (it already has the row).
- [ ] **Step 4:** Run `bun test` → PASS (existing team, pool and credit tests unchanged).
- [ ] **Step 5: Commit** `feat: notify team, pool, payment and credit events`

### Task 6: Notifications for match day and the check-in reminder

**Files:**
- Create: `src/server/jobs/check-in-reminders.ts`
- Modify: `src/shared/check-in.ts`, `src/server/matchday/check-in.ts`, `src/server/bracket/bracket.ts` (`syncMatches`), `src/server/matchday/moderation.ts`, `src/server/matchday/reports.ts`, `src/server/jobs/boss.ts`
- Test: `tests/server/notifications/matchday-triggers.test.ts`, `tests/server/jobs/check-in-reminders.test.ts`

**Interfaces:**
- Consumes: Task 2; Plan 5 `checkInWindow`, `checkInOutcome`.
- Produces:
  ```ts
  export const CHECK_IN_REMINDER_BEFORE_CLOSE_MINUTES = 15;   // shared/check-in.ts
  sendCheckInReminders(db: Db, now: Date): Promise<{ reminded: number }>;
  ```
  | Where | To | Payload | Dedupe key |
  |---|---|---|---|
  | `openCheckIn` ok | active rosters of confirmed registrations | `check_in_open` | `check_in_open:<registrationId>` |
  | `sendCheckInReminders`: tournament `check_in`, `closesAt − 15 min ≤ now < closesAt`, fewer than 5 active players checked in | captain | `check_in_reminder` with `missing = 5 − checkedIn` | `check_in_reminder:<registrationId>` |
  | `syncMatches`, a match becoming `open` with both teams | both active rosters | `match_ready`, `opponent` = the other team's name | `match_ready:<matchId>:<openedAt ISO>` |
  | `confirmMatch` / `forfeitMatch` ok | both active rosters | `result_confirmed`, `won` and `score` from each side's view | `result:<matchId>:<confirmedAt ISO>` |
  | `reportResult` moving a match to `disputed` from another status | both captains | `match_disputed` | `disputed:<matchId>:<openedAt ISO>` |

- [ ] **Step 1: Write the failing tests:**
  - `matchday-triggers.test.ts` (Review Focus 2): `openCheckIn` on two confirmed teams → 12 `check_in_open`; a second `openCheckIn` (`invalid_state`) → none. `startedTestTournament(4)` → `match_ready` for the 24 players of the two first-round matches, each naming the right opponent; with 3 teams the bye match notifies nobody; confirming a semifinal notifies both rosters `result_confirmed` with `won: true` for the winner and `score` in own-first order, and the final's `match_ready` is sent only once both finalists are known; `resetMatch` then a new open → a new `match_ready` (new `openedAt`). Conflicting reports → both captains get `match_disputed` once; a captain updating a report while still disputed → no new one.
  - `check-in-reminders.test.ts`: at `closesAt − 16 min` nothing; at `closesAt − 15 min` the captain of a team with 4 checked in is reminded (`missing: 1`) and a team with 5 is not; a swapped-out player's check-in doesn't count; re-running → `reminded: 0`; at `closesAt` nothing.
- [ ] **Step 2:** Run `bun test tests/server/notifications/matchday-triggers.test.ts tests/server/jobs/check-in-reminders.test.ts` → FAIL.
- [ ] **Step 3: Implement** the table. Run `sendCheckInReminders` from the `advance-tournaments` worker after opening/closing (same minute cadence), logging its count.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: notify match-day events and remind captains before check-in closes`

### Task 7: Email delivery

**Files:**
- Create: `src/server/email/mailer.ts`, `src/server/email/render.ts`, `src/server/notifications/settings.ts`, `src/server/jobs/send-emails.ts`, `tests/helpers/recording-mailer.ts`
- Modify: `src/server/db/schema/notifications.ts` (`notification_settings`), `src/server/env.ts`, `src/server/jobs/boss.ts`, `.env.example`, `src/shared/i18n/es-AR.ts`
- Test: `tests/server/email/mailer.test.ts`, `tests/server/email/render.test.ts`, `tests/server/jobs/send-emails.test.ts`, `tests/server/env.test.ts`

**Interfaces:**
- Consumes: Task 2 (`notifications` rows, `notificationText`, `notificationHref`, `EMAIL_TTL_MS`, `NO_EMAIL_DOMAIN`), `siteOrigin`.
- Produces:
  ```ts
  // env: RESEND_API_KEY optional; EMAIL_FROM required when RESEND_API_KEY is set
  type EmailMessage = { to: string; subject: string; text: string; html: string };
  type SendResult = { ok: true } | { ok: false; retryable: boolean };
  interface Mailer { send(message: EmailMessage): Promise<SendResult> }
  createResendMailer(opts: { apiKey: string; from: string; fetch?: typeof fetch }): Mailer;   // POST https://api.resend.com/emails
  createLogMailer(): Mailer;   // development: logs subject and recipient, returns ok
  renderNotificationEmail(payload: NotificationPayload, origin: string): Omit<EmailMessage, "to">;
  // schema: notification_settings(user_id pk fk, email_enabled boolean default true); no row = enabled
  getEmailEnabled(db: Executor, userId: string): Promise<boolean>;
  setEmailEnabled(db: Db, userId: string, enabled: boolean): Promise<void>;
  sendPendingEmails(deps: { db: Db; mailer: Mailer; origin: string }, now: Date, batch?: number): Promise<{ sent: number; skipped: number; failed: number }>;
  const MAX_EMAIL_ATTEMPTS = 3;
  ```

- [ ] **Step 1: Write the failing tests** (Review Focus 3):
  - `mailer.test.ts`: sends `Authorization: Bearer <key>`, JSON `{ from, to: [to], subject, text, html }`; 200 → ok; 429, 500 and a network error → `retryable: true`; 422 → `retryable: false`.
  - `render.test.ts`: subject = `notificationText(p).title`; text and html contain the absolute link `<origin><href>` and a footer link to `<origin>/notificaciones`; a team named `<script>alert(1)</script> & "x"` appears escaped in html (no `<script`) and raw in text.
  - `send-emails.test.ts`: a pending row → sent, `emailed_at` set, `email_status: "sent"`; an opted-out player → `skipped`, mailer not called; a `@riot.invalid` address → `skipped`; a `match_ready` created 2 h ago → `skipped`, a `payment_recorded` created 2 h ago → sent; a retryable failure leaves the row `pending` with `email_attempts: 1`, the third failure makes it `failed`; a non-retryable failure → `failed` at once; two concurrent `sendPendingEmails` calls send each row once; a row left `sending` for more than 10 minutes (crash) goes back to `pending`.
  - `env.test.ts`: `RESEND_API_KEY` without `EMAIL_FROM` → error naming `EMAIL_FROM`; neither → valid.
- [ ] **Step 2:** Run `bun test tests/server/email tests/server/jobs/send-emails.test.ts tests/server/env.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Claim with one statement: `UPDATE notifications SET email_status = 'sending', email_attempts = email_attempts + 1 WHERE id IN (SELECT id … WHERE email_status = 'pending' ORDER BY created_at LIMIT $batch FOR UPDATE SKIP LOCKED) RETURNING …`, then send outside any transaction and write the outcome. Skip rules are checked before sending. Register `send-emails` every minute with `createResendMailer` when the key is set, else `createLogMailer`. `db:generate`; document both env vars in `.env.example`.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: send notification emails from an outbox`

### Task 8: In-app inbox

**Files:**
- Create: `src/server/notifications/notifications.functions.ts`, `src/routes/notificaciones.tsx`, `src/components/site/inbox-list.tsx`, `src/components/site/inbox-link.tsx`, `e2e/notifications.spec.ts`
- Modify: `src/server/viewer.functions.ts`, `src/components/site/site-header.tsx`, `src/shared/i18n/es-AR.ts`, `e2e/public-routes.ts` (if it lists noindex routes)
- Test: `tests/server/viewer.test.ts`

**Interfaces:**
- Consumes: Task 2 (`listNotifications`, `countUnread`, `markAllRead`, `notificationText`), Task 7 (`getEmailEnabled`, `setEmailEnabled`), Plan 5 `useRealtime`.
- Produces: `ViewerState` signed-in gains `userId: string` and `unreadNotifications: number`. `getInboxFn` (GET; signed out → redirect to `/ingresar`) returns `{ items: NotificationView[]; emailEnabled: boolean }`; `markAllReadFn({ upTo: string })`, `setEmailEnabledFn({ enabled: boolean })` (POST, own user only). `InboxLink` in the header: text link "Avisos" plus the count when > 0, accessible name "Avisos, 3 sin leer", subscribed to `user:<userId>` via `useRealtime`. `/notificaciones` (noindex): list rows (title, body, ART time, link to `href`, unread rows in display weight — no side-stripe borders, no red), an empty state, and the email switch; on mount it calls `markAllReadFn` with the newest item's `createdAt`.

- [ ] **Step 1: Write the failing tests:** `viewer.test.ts` — a signed-in viewer with two unread notifications has `unreadNotifications: 2` and their own `userId`. `notifications.spec.ts` (JavaScript enabled): a captain invites a player by Riot ID → the player's header shows "Avisos" with 1; `/notificaciones` lists "Te invitaron a <team>" linking to `/mis-equipos`; after a reload the count is gone; turning email off persists across reloads; signed out, `/notificaciones` lands on `/ingresar`; 320 px has no horizontal scroll.
- [ ] **Step 2:** Run `bun test tests/server/viewer.test.ts` → FAIL.
- [ ] **Step 3: Implement** the functions, header link and page.
- [ ] **Step 4:** Run `bun test` → PASS; `bun run typecheck` → clean; `bun run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat: add the in-app notification inbox`

### Task 9: Riot feature flags and clients

**Files:**
- Create: `src/server/riot/http.ts`, `src/server/riot/features.ts`, `src/server/riot/tournament-client.ts`, `tests/helpers/fake-riot-tournament.ts`
- Modify: `src/server/env.ts`, `src/server/riot/client.ts`, `src/server/riot/types.ts`, `tests/helpers/fake-riot.ts`, `.env.example`
- Test: `tests/server/env.test.ts`, `tests/server/riot/client.test.ts`, `tests/server/riot/tournament-client.test.ts`

**Interfaces:**
- Consumes: Plan 1 Riot client (retry/backoff behavior).
- Produces:
  ```ts
  // env: RIOT_FEATURES (comma list of rso | tournament_codes | result_callbacks; empty = none), RIOT_RSO_CLIENT_ID, RIOT_RSO_CLIENT_SECRET,
  //      RIOT_TOURNAMENT_STUB ("true" → stub endpoints, default "false"), RIOT_CALLBACK_SECRET (≥ 32 chars)
  //      rso needs both RSO vars; result_callbacks needs tournament_codes and RIOT_CALLBACK_SECRET
  type RiotFeature = "rso" | "tournament_codes" | "result_callbacks";
  type RiotFeatures = { rso: boolean; tournamentCodes: boolean; resultCallbacks: boolean };
  riotFeatures(env: Env): RiotFeatures;   export const features: RiotFeatures;   // features.ts, from the real env
  riotRequest<T>(opts, method: "GET" | "POST", url: string, init: { headers: Record<string, string>; body?: unknown }): Promise<RiotResult<T>>;   // http.ts: the existing retry loop, moved
  RiotClient.getAccountByAccessToken(accessToken: string): Promise<RiotResult<RiotAccount>>;   // GET americas /riot/account/v1/accounts/me, Authorization: Bearer, no X-Riot-Token
  interface RiotTournamentClient {
    registerProvider(callbackUrl: string): Promise<RiotResult<number>>;              // POST /providers { region: "LAS", url }
    createTournament(providerId: number, name: string): Promise<RiotResult<number>>; // POST /tournaments { name, providerId }
    createCodes(tournamentId: number, count: number, opts: { pickType: "TOURNAMENT_DRAFT" | "BLIND_PICK"; metadata: string }): Promise<RiotResult<string[]>>;
                                         // POST /codes?tournamentId&count { mapType: "SUMMONERS_RIFT", pickType, spectatorType: "ALL", teamSize: 5, metadata }
  }
  createRiotTournamentClient(opts: RiotClientOptions & { stub: boolean }): RiotTournamentClient;   // base americas /lol/tournament/v5 or /lol/tournament-stub/v5
  // fakes: FakeRiotClient.addAccessToken(token, account); FakeRiotTournamentClient records calls, can be set to fail, hands out codes "LA2-CODE-1", …
  ```

- [ ] **Step 1: Write the failing tests:** `env.test.ts` — empty `RIOT_FEATURES` → all off; `"rso,tournament_codes"` with RSO vars → `{ rso: true, tournamentCodes: true, resultCallbacks: false }`; an unknown feature → error naming `RIOT_FEATURES`; `rso` without a client secret → error; `result_callbacks` without `tournament_codes` → error; a 20-character callback secret → error. `client.test.ts` — `getAccountByAccessToken` sends `Authorization: Bearer tok` and no `X-Riot-Token`; every existing client test still passes after the move to `http.ts`. `tournament-client.test.ts` — stub mode posts to `/lol/tournament-stub/v5/providers`, real mode to `/lol/tournament/v5/providers`, with `X-Riot-Token`; `createCodes` sends the body above with the given `pickType` and query `tournamentId` and `count`; a 429 then 200 retries once.
- [ ] **Step 2:** Run `bun test tests/server/env.test.ts tests/server/riot` → FAIL.
- [ ] **Step 3: Implement.** Check each endpoint and body against developer.riotgames.com (tournament-v5, account-v1) while implementing; if they differ from this plan, Riot's docs win and the fakes follow. Document the new env vars in `.env.example`.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: add Riot feature flags and tournament API client`

### Task 10: Riot Sign On

**Files:**
- Create: `src/server/identity/rso.ts`
- Modify: `src/server/auth.ts`, `src/auth-client.ts`, `src/routes/ingresar.tsx`, `src/routes/vincular-riot.tsx`, `src/server/identity/link-riot.functions.ts`, `src/shared/i18n/es-AR.ts`
- Test: `tests/server/identity/rso.test.ts`

**Interfaces:**
- Consumes: Task 9 (`features.rso`, `getAccountByAccessToken`), Plan 1 `recordRankSnapshot`, `riotAccounts`.
- Produces:
  ```ts
  export const RSO_PROVIDER_ID = "riot";
  rsoUserInfo(deps: { db: Db; riot: RiotClient }, accessToken: string):
    Promise<{ id: string; name: string; email: string; emailVerified: boolean } | null>;
    // id = puuid, name = "gameName#tagLine"; email = the linked user's email (emailVerified true) when the puuid is already linked,
    // else `${puuid}@${NO_EMAIL_DOMAIN}` (emailVerified false); null when Riot fails
  rsoLinkAllowed(db: Executor, userId: string, puuid: string): Promise<boolean>;   // false if the puuid is another user's, or the user has a different puuid
  linkRsoAccount(deps: { db: Db; riot: RiotClient }, userId: string, puuid: string):
    Promise<{ ok: true; riotAccountId: string } | { ok: false; reason: "taken_by_other" | "riot_unavailable" }>;
    // idempotent for the same user and puuid; reads summoner + account by puuid with the API key; audit riot_account.linked { via: "rso" }
  ```
  `auth.ts` with `features.rso`: `genericOAuth({ config: [{ providerId: "riot", clientId, clientSecret, authorizationUrl: "https://auth.riotgames.com/authorize", tokenUrl: "https://auth.riotgames.com/token", scopes: ["openid", "offline_access", "cpid"], getUserInfo: (tokens) => rsoUserInfo(…, tokens.accessToken) }] })`, `account.accountLinking: { enabled: true, trustedProviders: ["riot"] }`, `emailAndPassword.disableSignUp: true`, `databaseHooks.account.create.before` returning `false` when `providerId === "riot"` and `!rsoLinkAllowed`, `.after` calling `linkRsoAccount` (failures logged; the next poll fills ranks). Flag off: `auth.ts` is exactly as today. `getAuthOptions` returns `{ discord, rso }`; `/ingresar` with `rso` shows "Entrar con Riot" as the one primary action (`authClient.signIn.oauth2({ providerId: "riot" })`) and keeps email/Discord sign-in under "¿Ya tenías cuenta?" with no sign-up toggle; `/vincular-riot` with `rso` offers "Vincular con Riot" (`authClient.oauth2.link`) instead of the icon challenge.

- [ ] **Step 1: Write the failing tests** (`rso.test.ts`, Review Focus 5, FakeRiotClient + test DB): a new puuid → placeholder email, `emailVerified: false`, name `gameName#tagLine`; a puuid linked to user A → A's email, `emailVerified: true`; `getAccountByAccessToken` unavailable → `null`. `rsoLinkAllowed`: puuid of another user → false; user already linked to a different puuid → false; same user and puuid → true; nobody → true. `linkRsoAccount` creates the account with summoner level and icon, records a first rank snapshot, writes the audit row; a second call → ok with the same id; a racing insert for the puuid by another user → `taken_by_other`; summoner lookup failing → `riot_unavailable` and nothing stored.
- [ ] **Step 2:** Run `bun test tests/server/identity/rso.test.ts` → FAIL.
- [ ] **Step 3: Implement** `rso.ts`, the flagged auth wiring, `genericOAuthClient()` in `auth-client.ts`, and the two pages.
- [ ] **Step 4:** Run `bun test` → PASS; `bun run typecheck` → clean; `bun run test:e2e -- session-flow link-riot` → PASS (flags off in e2e: unchanged pages).
- [ ] **Step 5: Commit** `feat: sign in and link accounts with Riot Sign On behind a flag`

### Task 11: Tournament codes

**Files:**
- Create: `src/server/matchday/tournament-codes.ts`
- Modify: `src/server/db/schema/matchday.ts` (`matches.tournament_code`), `src/server/db/schema/competition.ts` (`tournaments.riot_tournament_id`), `src/server/bracket/bracket.ts` (`MatchView.tournamentCode`), `src/server/matchday/moderation.ts` (`resetMatch` clears the code), `src/components/matchday/lobby-box.tsx`, `src/server/jobs/boss.ts`, `src/shared/i18n/es-AR.ts`
- Test: `tests/server/matchday/tournament-codes.test.ts`, `tests/server/jobs/boss.test.ts`

**Interfaces:**
- Consumes: Task 9 (`RiotTournamentClient`, `features`), Plan 5 `lockMatch`, `announceMatch`, `canSeeMatchPrivate`, `settings` table.
- Produces:
  ```ts
  issueTournamentCodes(deps: { db: Db; client: RiotTournamentClient; callbackUrl: string }, now: Date): Promise<{ issued: number; failed: number }>;
  riotCallbackUrl(origin: string, secret: string | undefined): string;   // `${origin}/api/riot/callback/${secret ?? "off"}`
  // MatchView.tournamentCode: string | null — private exactly like `lobby`
  ```
  For each match of a `live` tournament with status `open`, both teams, no lobby and no code: ensure the provider (cached in `app_settings` key `riot_tournament_provider` as `{ url, id }`; re-registered when the URL changes) and the tournament's `riot_tournament_id` (name `"<title> #<edition>"`), request one code with `metadata = match.id` and the tournament's draft mode, then in a transaction lock the match and, only if it is still `open` with no lobby and no code, store the code, set `in_progress`, insert a `lobby` chat message with the code, audit `match.code_issued` (actor `null`). Announce after commit. The job is registered only when `features.tournamentCodes`.
  `LobbyBox` shows "Código de torneo" with the code (selectable) when present; otherwise as today.

- [ ] **Step 1: Write the failing tests** (`tournament-codes.test.ts` with `FakeRiotTournamentClient`, `startedTestTournament(4)`): two open matches → two codes, both `in_progress`, a lobby chat message each; the provider and the Riot tournament are created once across two runs and both matches; `getMatchView` shows the code to a participant and a moderator and `null` to an outsider and a signed-out viewer; Riot failing → `failed: 2`, matches stay `open` and the console still lists them as `lobby`, and the next run issues them; a moderator posting a manual lobby while the code request is in flight → the code is discarded and the lobby kept; `resetMatch` clears the code and the next run issues a new one; a match with one team (waiting) gets none. `boss.test.ts`: with tournament codes off, `registerJobs` creates no `issue-tournament-codes` queue; on, it does.
- [ ] **Step 2:** Run `bun test tests/server/matchday/tournament-codes.test.ts tests/server/jobs/boss.test.ts` → FAIL.
- [ ] **Step 3: Implement** the job, schema (`db:generate`), view field, reset change and lobby box.
- [ ] **Step 4:** Run `bun test` → PASS.
- [ ] **Step 5: Commit** `feat: issue Riot tournament codes per match behind a flag`

### Task 12: Result callbacks

**Files:**
- Create: `src/server/riot/callback.ts`
- Modify: `src/server/db/schema/matchday.ts` (`matches.riot_score`), `src/server/matchday/stats.ts`, `src/server/matchday/moderation.ts` (`confirmMatch`), `src/server/api.ts`, `src/server/jobs/boss.ts`, the moderator override form in `src/routes/mod.tsx` (score inputs default to `riotScore`, with a "Resultado de Riot" note), `src/server/bracket/bracket.ts` (`MatchView.riotScore`, private)
- Test: `tests/server/riot/callback.test.ts`, `tests/server/matchday/riot-results.test.ts`, `tests/server/api.test.ts`

**Interfaces:**
- Consumes: Task 9 (`features`), Task 11 (`matches.tournament_code`), Plan 5 `validateScore`, `announceMatch`.
- Produces:
  ```ts
  // stats.ts: the body of attachRiotMatchIds after its permission check, for system callers
  attachVerifiedRiotMatchIds(deps: { db: Db; riot: RiotClient }, actorUserId: string | null, matchId: string, riotMatchIds: string[]):
    Promise<{ ok: true } | { ok: false; reason: Exclude<StatsRejection, "forbidden"> }>;
    // after storing stats it recomputes matches.riot_score = { score1, score2 } (a game's winner is the side whose roster has ≥ 3 players
    // on winningTeamId) and, when validateScore(bestOf, …) holds and the match is open or in_progress, sets status "reported"
  riotCallbackSchema: z.ZodType<{ shortCode: string; gameId: number }>;   // extra fields allowed
  handleRiotCallback(deps: { db: Db; enqueue(job: { matchId: string; riotMatchId: string }): Promise<void> }, body: unknown):
    Promise<"queued" | "ignored" | "invalid">;   // ignored: unknown code or completed match
  ```
  `api.ts` with `features.resultCallbacks`: `POST /api/riot/callback/:secret` — secret compared with `crypto.timingSafeEqual` (length mismatch → 404), `invalid` → 400, otherwise 200 `{ ok: true }`. The `riot-game-result` queue (send with `singletonKey: riotMatchId`, `retryLimit: 10`, `retryDelay: 60`, `retryBackoff: true`) calls `attachVerifiedRiotMatchIds(…, null, …)`; `invalid_id` (game not in match-v5 yet) and `riot_unavailable` throw so pg-boss retries; `not_this_match` is logged and dropped. `confirmMatch` without an explicit result uses `riot_score` when it passes `validateScore` (audit `source: "riot"`), else the reports as today.

- [ ] **Step 1: Write the failing tests** (Review Focus 4):
  - `api.test.ts`: callbacks off → the route is 404; on, a wrong or shorter secret → 404, a junk body → 400, a valid body → 200.
  - `callback.test.ts`: a known code → enqueues `{ matchId, riotMatchId: "LA2_<gameId>" }`; an unknown code → `ignored`, nothing enqueued; a completed match → `ignored`.
  - `riot-results.test.ts` (fake Riot, Bo3 match): game 1 won by side 1 → `riot_score 1-0`, status unchanged; game 2 won by side 1 → `2-0`, status `reported`, the console lists it as `confirm`; the same game attached twice counts once; a game with players from neither roster → `not_this_match`, no score; a game not yet in match-v5 → `invalid_id` (the worker throws); `confirmMatch` with no reports uses `2-0` with audit `source: "riot"`; conflicting captain reports keep the match `disputed`, and confirming without a score still uses the Riot score; `attachRiotMatchIds` for an outsider is still `forbidden`.
- [ ] **Step 2:** Run `bun test tests/server/riot/callback.test.ts tests/server/matchday/riot-results.test.ts tests/server/api.test.ts` → FAIL.
- [ ] **Step 3: Implement** the split, score derivation, callback handler, route, queue and `confirmMatch` change; `db:generate`.
- [ ] **Step 4:** Run `bun test` → PASS; `bun run typecheck` → clean; `bun run test:e2e` → PASS.
- [ ] **Step 5: Commit** `feat: pre-fill results from Riot tournament callbacks behind a flag`

---

## Self-review notes

- Spec coverage: §5.11 recurring templates (fields, schedule, auto-create, increment, open registration, edition edits independent) → Tasks 1, 3, 4; §2 anti-goal "always open or upcoming" → Task 1 (`hasUpcoming`), Task 3; §5.12 every listed moment → Tasks 5, 6 (tables), in-app → Tasks 2, 8, email → Task 7; §5.6 captain reminder 15 min before the deadline → Task 6; §5.10 RSO → Task 10, tournament codes → Task 11, result callbacks with moderator confirmation → Task 12, per-capability switch → Task 9. Admin moderator-assignment UI and team waitlist promotion stay out (not in this roadmap row).
- Type consistency: `NotificationPayload` (Task 2) is the only payload type `notify` (Tasks 5, 6), `renderNotificationEmail` (Task 7) and the inbox (Task 8) use; `TemplateInput`/`EditionPlan` (Task 1) are what Task 3 stores and Task 4's forms send; `RiotFeatures` (Task 9) gates Tasks 10–12; `matches.tournament_code` (Task 11) is what Task 12's callback looks up; `attachVerifiedRiotMatchIds` keeps `StatsRejection` from Plan 5.
- Order: Task 7 adds `notification_settings` to the schema file Task 2 created; Task 12 needs Task 11's column; Tasks 5–6 need only Task 2.
