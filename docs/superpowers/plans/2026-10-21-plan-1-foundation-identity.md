# Plan 1: Foundation & Identity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running Bun + TanStack Start app where a player signs up (Discord or email), proves ownership of an LAS Riot account via the profile-icon challenge, gets their solo/duo rank tracked (current + observed season peak), and has a public server-rendered profile page.

**Architecture:** One TanStack Start app (SSR, React 19, Vite) on Bun. Hono is mounted under `/api` for auth and non-page endpoints. Server-only code lives in `src/server/` (DB, auth, Riot client, domain services, jobs); pure shared logic lives in `src/shared/`. Postgres via Drizzle; background jobs via pg-boss on the same database.

**Tech Stack:** Bun, TypeScript (strict), TanStack Start + Router, React 19, Hono, PostgreSQL 17, Drizzle ORM + drizzle-kit, Better Auth, pg-boss, Zod, Tailwind v4, `bun test`, Playwright (one SSR smoke test), Docker Compose (local Postgres).

**Spec:** `docs/superpowers/specs/2026-10-21-gorosei-mvp-design.md` · **Roadmap:** `docs/superpowers/plans/2026-10-21-gorosei-roadmap.md`

## Global Constraints

- Server: LAS only. Riot platform host `https://la2.api.riotgames.com`; regional (account) host `https://americas.api.riotgames.com`.
- Riot API key from env `RIOT_API_KEY` (development key during development); sent as header `X-Riot-Token`. No no-API mode.
- Rank queue: `RANKED_SOLO_5x5` only.
- One Riot account per platform user and one platform user per Riot account (unique on `puuid` and on `user_id`).
- Store timestamps in UTC (`timestamptz`); display in `America/Argentina/Buenos_Aires`.
- UI language es-AR only; every user-facing string goes through `t()` (Task 3). No hard-coded copy in components.
- Roles: `player` (default), `moderator`, `admin`.
- No in-platform payments of any kind.
- Visual styling is out of scope for this plan (Plan 2). Pages use plain semantic HTML + minimal Tailwind; do **not** introduce card grids or gradients.
- No scraping of third-party rank sites.
- Use the current stable versions of all libraries at execution time; follow each library's current docs for setup commands.

## Review Focus

1. **Riot IDs with spaces, accents, mixed case** (e.g. `Señor Café#LAS`) — lookups must URL-encode name and tag, matching is case-insensitive, and the profile URL round-trips. → tests in Task 5 and Task 9.
2. **Unranked players** (no `RANKED_SOLO_5x5` entry) — must produce `null` rank, never crash, and display "Sin clasificar". → tests in Task 4 and Task 8.
3. **Riot API 429 / 5xx / 404** — 429 honors `Retry-After` then retries; 404 maps to a typed "not found" result shown as a friendly error, not a 500. → tests in Task 5.
4. **Riot account already linked to another user**, or a user trying to link a second account — rejected with a clear error, no partial rows. → tests in Task 7.
5. **Challenge expired or icon not changed yet** — confirmation fails with distinct reasons; an expired challenge can be restarted. → tests in Task 7.

---

## File Structure

```
docker-compose.yml               local Postgres 17 (dev + test DBs)
.env.example                     DATABASE_URL, TEST_DATABASE_URL, RIOT_API_KEY, BETTER_AUTH_SECRET, BETTER_AUTH_URL, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET
drizzle.config.ts
src/
  routes/                        TanStack file routes (pages only)
    __root.tsx
    index.tsx                    placeholder home
    ingresar.tsx                 sign in / sign up
    vincular-riot.tsx            Riot link flow
    jugador.$riotId.tsx          public profile (SSR)
  server/
    env.ts                       Zod-validated env
    db/client.ts                 drizzle instance
    db/schema/auth.ts            Better Auth tables (generated)
    db/schema/identity.ts        riot_accounts, riot_link_challenges, rank_snapshots, rank_overrides
    db/schema/platform.ts        app_settings, audit_log
    db/schema/index.ts
    api.ts                       Hono app mounted at /api
    auth.ts                      Better Auth instance
    audit.ts                     writeAudit()
    settings.ts                  getSeasonStart()/setSeasonStart()
    riot/types.ts
    riot/client.ts               RiotClient
    identity/link-riot.ts        challenge start/confirm
    identity/ranks.ts            snapshots, effective rank, overrides
    identity/profile.ts          getPublicProfile()
    jobs/boss.ts                 pg-boss setup + schedule registration
    jobs/poll-ranks.ts
  shared/
    rank.ts                      Rank type, parse, value, compare
    riot-id.ts                   parse/format/slug Riot IDs
    i18n/index.ts, i18n/es-AR.ts
tests/
  helpers/db.ts                  resetTestDb(), testDb
  helpers/fake-riot.ts           FakeRiotClient
  (unit/integration tests mirror src/, e.g. tests/shared/rank.test.ts)
e2e/profile.spec.ts
```

---

### Task 1: Scaffold the app, local Postgres, health endpoint

**Files:**
- Create: project scaffold (TanStack Start, Bun), `docker-compose.yml`, `.env.example`, `src/server/env.ts`, `src/server/api.ts`
- Modify: `.gitignore` (keep existing `.superpowers/`, `node_modules/`, `.env*` lines; add build outputs)
- Test: `tests/server/api.test.ts`

**Interfaces:**
- Produces: `env` (typed, Zod-parsed object with the keys in `.env.example`); `api: Hono` with base path `/api`, mounted into TanStack Start so `/api/*` is handled by Hono.

- [ ] **Step 1:** Scaffold a TanStack Start React app with Bun as package manager and runtime, TypeScript strict, Tailwind v4. Add `docker-compose.yml` with a `postgres:17` service creating databases `gorosei` and `gorosei_test`.
- [ ] **Step 2: Write the failing test** `tests/server/api.test.ts`:

```ts
test("GET /api/health returns ok", async () => {
  const res = await api.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});
```

- [ ] **Step 3:** Run `bun test tests/server/api.test.ts` → FAIL (module not found).
- [ ] **Step 4:** Implement `src/server/env.ts` (Zod schema; throws listing missing keys) and `src/server/api.ts` (`new Hono().basePath("/api")`, `GET /health`). Mount it via a TanStack Start server route catch-all for `/api/$`.
- [ ] **Step 5:** Run `bun test` → PASS. Run `bun run dev`, `curl localhost:3000/api/health` → `{"ok":true}`.
- [ ] **Step 6: Commit** `feat: scaffold TanStack Start app with Hono api and health check`

### Task 2: Database, schema, test helper

**Files:**
- Create: `drizzle.config.ts`, `src/server/db/client.ts`, `src/server/db/schema/{identity,platform,index}.ts`, `tests/helpers/db.ts`, first migration under `drizzle/`
- Test: `tests/server/db.test.ts`

**Interfaces:**
- Produces: `db` (Drizzle client), `createDb(url: string)`; tables:
  - `riot_accounts(id uuid pk, user_id text unique not null → user.id, puuid text unique not null, game_name text, tag_line text, summoner_level int, profile_icon_id int, linked_at timestamptz, last_polled_at timestamptz null)`
  - `riot_link_challenges(id uuid pk, user_id text unique → user.id, puuid text, game_name text, tag_line text, required_icon_id int, expires_at timestamptz, created_at timestamptz)`
  - `rank_snapshots(id uuid pk, riot_account_id uuid → riot_accounts.id, tier text null, division text null, lp int null, wins int, losses int, observed_at timestamptz)`; index `(riot_account_id, observed_at)`. `tier=null` means unranked.
  - `rank_overrides(riot_account_id uuid pk → riot_accounts.id, tier text, division text, reason text, set_by text → user.id, set_at timestamptz)`
  - `app_settings(key text pk, value jsonb)`
  - `audit_log(id uuid pk, actor_user_id text null, action text, entity_type text, entity_id text, data jsonb, created_at timestamptz default now())`
- Produces: `resetTestDb(): Promise<void>` (truncates all tables in `TEST_DATABASE_URL`), `testDb`.
- Note: `user` table comes from Better Auth in Task 6; in this task create a minimal `user(id text pk)` placeholder only if needed for FKs, and replace it with the generated schema in Task 6.

- [ ] **Step 1: Write the failing test**: insert a `riot_accounts` row twice with the same `puuid` → second insert rejects with a unique-violation error; `resetTestDb()` leaves the table empty.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement schema + client; `bunx drizzle-kit generate` then migrate the test DB in `tests/helpers/db.ts` (run migrations once per test process).
- [ ] **Step 4:** Run `bun test tests/server/db.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat: add drizzle schema for identity and platform tables`

### Task 3: i18n layer (es-AR)

**Files:**
- Create: `src/shared/i18n/es-AR.ts`, `src/shared/i18n/index.ts`
- Test: `tests/shared/i18n.test.ts`

**Interfaces:**
- Produces: `t(key: MessageKey, params?: Record<string, string | number>): string` where `MessageKey` is derived from the es-AR dictionary (typo → compile error); `formatDateTime(d: Date): string` in `America/Argentina/Buenos_Aires`, locale `es-AR`.

- [ ] **Step 1: Write the failing tests**:
  - `t("rank.unranked")` → `"Sin clasificar"`
  - `t("riotLink.setIcon", { iconId: 7 })` contains `"7"`
  - `formatDateTime(new Date("2026-10-26T21:00:00Z"))` contains `"18:00"` (ART = UTC−3)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with `{name}` interpolation and `Intl.DateTimeFormat`. Seed keys needed by Tasks 4–9.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: add typed es-AR i18n`

### Task 4: Rank domain (pure)

**Files:**
- Create: `src/shared/rank.ts`
- Test: `tests/shared/rank.test.ts`

**Interfaces:**
- Produces:
  - `type Tier = "IRON"|"BRONZE"|"SILVER"|"GOLD"|"PLATINUM"|"EMERALD"|"DIAMOND"|"MASTER"|"GRANDMASTER"|"CHALLENGER"`
  - `type Division = "IV"|"III"|"II"|"I"`
  - `type Rank = { tier: Tier; division: Division; lp: number }`
  - `rankValue(r: Rank): number` — below MASTER: `tierIndex*4 + {IV:0,III:1,II:2,I:3}[division]` (IRON IV = 0, DIAMOND I = 27); MASTER = 28, GRANDMASTER = 29, CHALLENGER = 30 (division ignored). LP does not affect value.
  - `compareRanks(a: Rank|null, b: Rank|null): number` — null (unranked) sorts lowest.
  - `maxRank(ranks: (Rank|null)[]): Rank|null` — ties broken by higher LP.
  - `formatRank(r: Rank|null): string` — es-AR via `t`, e.g. `"Diamante I"`, `"Maestro"`, `"Sin clasificar"`.

- [ ] **Step 1: Write the failing tests**: `rankValue({IRON,IV})===0`, `rankValue({DIAMOND,I})===27`, `rankValue({MASTER,I})===28`, `rankValue({CHALLENGER,I})===30`; `compareRanks(null, {IRON,IV,0}) < 0`; `maxRank([{GOLD,II,10},{GOLD,II,50},null])` returns lp 50; `formatRank({MASTER,"I",120})==="Maestro"`; `formatRank(null)==="Sin clasificar"`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: add rank domain helpers`

### Task 5: Riot ID helpers and Riot API client

**Files:**
- Create: `src/shared/riot-id.ts`, `src/server/riot/types.ts`, `src/server/riot/client.ts`, `tests/helpers/fake-riot.ts`
- Test: `tests/shared/riot-id.test.ts`, `tests/server/riot/client.test.ts`

**Interfaces:**
- Produces (`riot-id.ts`): `parseRiotId(input: string): { gameName: string; tagLine: string } | null` (splits on last `#`, trims, rejects empty parts, gameName ≤ 16 chars, tagLine 3–5 chars); `formatRiotId(id): string` → `"name#tag"`; `riotIdToSlug(id): string` → `encodeURIComponent(\`${gameName}-${tagLine}\`)`; `slugToRiotId(slug: string)` (splits on **last** `-`).
- Produces (`client.ts`):

```ts
type RiotResult<T> = { ok: true; data: T } | { ok: false; error: "not_found" | "rate_limited" | "unavailable" };
interface RiotClient {
  getAccountByRiotId(gameName: string, tagLine: string): Promise<RiotResult<{ puuid: string; gameName: string; tagLine: string }>>;
  getSummonerByPuuid(puuid: string): Promise<RiotResult<{ profileIconId: number; summonerLevel: number }>>;
  getSoloRankByPuuid(puuid: string): Promise<RiotResult<(Rank & { wins: number; losses: number }) | null>>;
}
function createRiotClient(opts: { apiKey: string; fetch?: typeof fetch; maxRetries?: number }): RiotClient;
```

  Endpoints: `GET {americas}/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}`, `GET {la2}/lol/summoner/v4/summoners/by-puuid/{puuid}`, `GET {la2}/lol/league/v4/entries/by-puuid/{puuid}` (pick `queueType === "RANKED_SOLO_5x5"`, else `null`).
- Produces (`fake-riot.ts`): `FakeRiotClient implements RiotClient` with mutable in-memory accounts (`setIcon(puuid, id)`, `setRank(puuid, rank|null)`).

- [ ] **Step 1: Write the failing tests**:
  - `parseRiotId("Señor Café#LAS")` → `{gameName:"Señor Café", tagLine:"LAS"}`; `parseRiotId("nohash")` → null; `slugToRiotId(riotIdToSlug(x))` round-trips for `"a-b#1234"`.
  - Client with stub fetch: request URL for `"Señor Café","LAS"` is URL-encoded and has header `X-Riot-Token`.
  - 404 → `{ok:false,error:"not_found"}`.
  - 429 with `Retry-After: 0` then 200 → `ok:true` with 2 fetch calls; 429 beyond `maxRetries` → `"rate_limited"`.
  - 503 → `"unavailable"` after retries.
  - League response without solo queue entry → `{ok:true,data:null}`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; retry 429 honoring `Retry-After` seconds and 5xx with short exponential backoff (cap total retries at `maxRetries`, default 3).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: add Riot ID helpers and LAS Riot API client`

### Task 6: Authentication (Discord + email) and roles

**Files:**
- Create: `src/server/auth.ts`, `src/server/db/schema/auth.ts` (generated by Better Auth CLI), `src/routes/ingresar.tsx`
- Modify: `src/server/api.ts` (mount `/api/auth/*`), `src/server/db/schema/index.ts`
- Test: `tests/server/auth.test.ts`

**Interfaces:**
- Produces: `auth` (Better Auth instance, Drizzle adapter, `emailAndPassword` enabled, Discord social provider, user additional field `role: "player"|"moderator"|"admin"` default `"player"`, not settable by the user); `getSessionUser(headers: Headers): Promise<{ id: string; role: Role; name: string } | null>`; `requireRole(headers, role: Role)` throws 403 for insufficient role (admin ⊇ moderator ⊇ player).

- [ ] **Step 1: Write the failing tests**: email sign-up via `auth.api` creates a user with `role === "player"`; sign-up payload containing `role: "admin"` still yields `"player"`; `requireRole` with a player session for `"moderator"` throws 403.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; generate the auth schema, migrate; build `ingresar.tsx` with "Continuar con Discord" and email/password forms (strings via `t`).
- [ ] **Step 4:** Run `bun test` → PASS. Manually sign up with email in `bun run dev`.
- [ ] **Step 5: Commit** `feat: add Better Auth with Discord, email and roles`

### Task 7: Riot account linking via icon challenge

**Files:**
- Create: `src/server/identity/link-riot.ts`, `src/server/audit.ts`, `src/routes/vincular-riot.tsx`
- Test: `tests/server/identity/link-riot.test.ts`

**Interfaces:**
- Consumes: `RiotClient`, `parseRiotId`, `db`. (Recording the first rank snapshot on confirm is added in Task 8.)
- Produces:

```ts
type StartResult = { ok: true; requiredIconId: number; expiresAt: Date }
  | { ok: false; reason: "invalid_riot_id" | "riot_not_found" | "already_linked_self" | "taken_by_other" | "riot_unavailable" };
startRiotLink(deps: { db; riot: RiotClient; now?: () => Date; random?: () => number }, userId: string, riotIdInput: string): Promise<StartResult>;

type ConfirmResult = { ok: true; riotAccountId: string }
  | { ok: false; reason: "no_challenge" | "expired" | "icon_mismatch" | "taken_by_other" | "riot_unavailable" };
confirmRiotLink(deps, userId: string): Promise<ConfirmResult>;

writeAudit(db, entry: { actorUserId: string | null; action: string; entityType: string; entityId: string; data?: unknown }): Promise<void>;
```

  Rules: required icon is a random id in `0..28` (free default icons) **different from the current icon**; challenge lasts **30 minutes**; starting again replaces the user's existing challenge; confirm re-fetches the summoner, checks `profileIconId === requiredIconId`, then in one transaction inserts `riot_accounts` (refreshing gameName/tagLine/level from Riot), deletes the challenge, writes audit `riot_account.linked`.

- [ ] **Step 1: Write the failing tests** (with `FakeRiotClient`, fixed `now`, `random`):
  - start with `"nohash"` → `invalid_riot_id`; unknown account → `riot_not_found`.
  - start returns an icon ≠ current icon and `expiresAt = now + 30min`.
  - confirm before changing icon → `icon_mismatch`; after `fake.setIcon(...)` → ok, row exists, challenge gone, audit row written.
  - confirm at `now + 31min` → `expired`; a new start then succeeds.
  - user who already has a linked account → start gives `already_linked_self`.
  - puuid linked to another user → start gives `taken_by_other`; if another user links between start and confirm → confirm gives `taken_by_other` and no row is written for the second user.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement services and the `vincular-riot.tsx` page (enter Riot ID → show required icon id + countdown → "Ya lo cambié" button → success/specific error messages via `t`). Call them through TanStack Start server functions guarded by `getSessionUser`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: link Riot accounts via profile icon challenge`

### Task 8: Rank tracking, effective rank, overrides, polling job

**Files:**
- Create: `src/server/identity/ranks.ts`, `src/server/settings.ts`, `src/server/jobs/boss.ts`, `src/server/jobs/poll-ranks.ts`
- Modify: `src/server/identity/link-riot.ts` (record first snapshot on confirm)
- Test: `tests/server/identity/ranks.test.ts`, `tests/server/jobs/poll-ranks.test.ts`

**Interfaces:**
- Produces:

```ts
type RankSource = "current" | "peak_season";
recordRankSnapshot(deps: { db; riot: RiotClient; now?: () => Date }, riotAccountId: string): Promise<"recorded" | "riot_unavailable">;
// also refreshes riot_accounts.game_name/tag_line/summoner_level/last_polled_at
getCurrentRank(db, riotAccountId: string): Promise<Rank | null>;      // latest snapshot
getSeasonPeak(db, riotAccountId: string): Promise<Rank | null>;       // maxRank over snapshots with observed_at >= season start
getEffectiveRank(db, riotAccountId: string, source: RankSource): Promise<Rank | null>; // override wins if present
setRankOverride(db, actorUserId: string, riotAccountId: string, rank: Pick<Rank, "tier" | "division">, reason: string): Promise<void>; // audit "rank.override_set"
clearRankOverride(db, actorUserId: string, riotAccountId: string): Promise<void>;                                        // audit "rank.override_cleared"
getSeasonStart(db): Promise<Date>; setSeasonStart(db, actorUserId: string, d: Date): Promise<void>; // app_settings key "season_start"
pollAllRanks(deps): Promise<{ polled: number; failed: number }>;  // accounts ordered by last_polled_at nulls first
registerJobs(boss: PgBoss): Promise<void>; // schedules "poll-ranks" every 6 hours
```

- [ ] **Step 1: Write the failing tests**:
  - snapshots GOLD II → PLAT IV → GOLD I (all this season): current = GOLD I, peak = PLAT IV.
  - a DIAMOND snapshot dated before season start is ignored by peak.
  - unranked account (fake rank `null`): snapshot stored with `tier=null`; current and peak = `null`.
  - override EMERALD II beats both sources; clearing it restores computed values; both write audit rows.
  - `recordRankSnapshot` when Riot returns `unavailable` → returns `"riot_unavailable"`, writes no snapshot.
  - `pollAllRanks` over 3 accounts with one failing → `{polled: 2, failed: 1}`; a Riot ID rename in the fake is reflected in `riot_accounts`.
  - `confirmRiotLink` success leaves exactly one snapshot.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. `boss.ts` starts pg-boss on `DATABASE_URL` when the server boots (not in tests). If `season_start` is unset, default to Jan 1 of the current year UTC.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: track solo rank snapshots with season peak and overrides`

### Task 9: Public player profile page (SSR)

**Files:**
- Create: `src/server/identity/profile.ts`, `src/routes/jugador.$riotId.tsx`, `src/routes/index.tsx` (placeholder linking to sign-in), `e2e/profile.spec.ts`, Playwright config
- Test: `tests/server/identity/profile.test.ts`, `e2e/profile.spec.ts`

**Interfaces:**
- Consumes: `slugToRiotId`, `getCurrentRank`, `getSeasonPeak`, `formatRank`.
- Produces: `getPublicProfile(db, gameName: string, tagLine: string): Promise<{ gameName; tagLine; profileIconId; summonerLevel; currentRank: Rank|null; seasonPeak: Rank|null; teams: []; tournaments: [] } | null>` — case-insensitive match on gameName+tagLine. `teams`/`tournaments` are empty arrays until Plan 3.

- [ ] **Step 1: Write the failing tests**:
  - `getPublicProfile(db, "señor café", "las")` finds an account stored as `"Señor Café"`/`"LAS"`.
  - unknown → `null`.
  - e2e: seed a linked account, `GET /jugador/<riotIdToSlug>` with JS disabled returns HTML containing the Riot ID, `formatRank` text, `<title>` containing the Riot ID, and a `meta[name=description]`; unknown slug returns HTTP 404 with a friendly es-AR message.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the loader (server-side) + page: Riot ID, level, current rank, season peak ("Pico de temporada"), empty "Equipos" and "Historial de torneos" sections.
- [ ] **Step 4:** Run `bun test` and `bunx playwright test` → PASS.
- [ ] **Step 5: Commit** `feat: add server-rendered public player profile`

---

## Done when

`bun test` and `bunx playwright test` pass; locally a user can sign up with email, link a Riot account via the icon challenge against the real API with a development key, and see their rank on `/jugador/<slug>`; the rank poll job runs on schedule.
