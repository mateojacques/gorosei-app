/**
 * Fills the local database with a playable picture of the platform: one cup per lifecycle stage, teams with
 * history, a free-agent pool, credits, payments, check-in in progress and a live bracket with every match state.
 *
 * Run with `bun run db:seed`. It wipes all competition data (templates, tournaments, teams, registrations, matches,
 * credits, notifications, audit log) and every earlier seed user (`@gorosei.test`), then rebuilds everything relative
 * to the current time. Users who signed up by hand keep their accounts and linked Riot IDs. Re-run it to reset the
 * clock: the check-in cup starts 45 minutes after seeding, and the dev server's jobs will remind its late captain,
 * close its check-in, start its bracket and create the first Copa Federal from its template.
 *
 * Every action notifies like it does in the app; the inbox is then backdated to when things happened, older items
 * marked read, and nothing seeded is emailed. Notifications the dev server's jobs create afterwards go through the
 * outbox as usual.
 *
 * Every seed user signs in with the password below. Riot is never called: a fake client stands in.
 */
import { and, asc, eq, inArray, like, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db/client";
import {
  entryCredits,
  matchMessages,
  matchReports,
  matches,
  notificationSettings,
  notifications,
  rankSnapshots,
  registrations,
  riotAccounts,
  teamMembers,
  teams,
  tournamentTemplates,
  tournaments,
  user,
} from "../src/server/db/schema";
import { closeCheckIn, checkIn, decideShortHanded, openCheckIn } from "../src/server/matchday/check-in";
import { postMessage } from "../src/server/matchday/chat";
import { confirmMatch, forfeitMatch, setMatchVod } from "../src/server/matchday/moderation";
import { postLobby, reportResult } from "../src/server/matchday/reports";
import { attachRiotMatchIds, attachVerifiedRiotMatchIds } from "../src/server/matchday/stats";
import { setRankOverride } from "../src/server/identity/ranks";
import { setEmailEnabled } from "../src/server/notifications/settings";
import { enterPool } from "../src/server/pool/pool";
import { recruitFromPool, requestFromPool } from "../src/server/pool/requests";
import type { RiotMatch } from "../src/server/riot/types";
import { createTeam, inviteByRiotId, requestToJoin } from "../src/server/teams/teams";
import { grantEligibilityException, markPaid } from "../src/server/tournaments/confirmations";
import { applyCredit, cancelTournament, closeRegistration, grantManualCredit, revokeCredit } from "../src/server/tournaments/credits";
import { registerTeam, withdrawRegistration } from "../src/server/tournaments/registrations";
import { createTemplate } from "../src/server/tournaments/templates";
import { createTournament, openRegistration } from "../src/server/tournaments/tournaments";
import type { EligibilityRule } from "../src/shared/eligibility";
import type { Role } from "../src/shared/pool";
import { DIVISIONS, TIERS } from "../src/shared/rank";
import type { Rank } from "../src/shared/rank";
import { type TemplateInput, templateInputSchema } from "../src/shared/templates";
import type { TournamentInput } from "../src/shared/tournament";
import { FakeRiotClient } from "../tests/helpers/fake-riot";

const PASSWORD = "gorosei-seed";
const EMAIL_DOMAIN = "gorosei.test";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = new Date();

const riot = new FakeRiotClient();
const deps = { db, riot };

// ---------------------------------------------------------------------------------------------------------------
// Deterministic randomness, so two runs build the same cups.

let rngState = 20261022;
function rng(): number {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;

/** A time on an Argentina (UTC-3) calendar day, `days` from today. */
function art(days: number, hour: number, minute = 0): Date {
  const local = new Date(NOW.getTime() - 3 * HOUR);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, hour + 3, minute));
}

/** The ART weekday (0 = Sunday) and "HH:MM" of an instant, as templates store them. */
function artSchedule(at: Date): Pick<TemplateInput, "weekday" | "startTime"> {
  const local = new Date(at.getTime() - 3 * HOUR);
  return { weekday: local.getUTCDay(), startTime: local.toISOString().slice(11, 16) };
}

function must<T extends { ok: boolean }>(label: string, result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(`${label} failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

// ---------------------------------------------------------------------------------------------------------------
// People.

type PlayerSpec = {
  handle: string;
  name: string;
  riot?: string;
  /** "EMERALD II 40", "MASTER 120" or null for unranked. */
  rank?: string | null;
  /** A higher rank reached earlier this season. */
  peak?: string;
  level?: number;
  games?: number;
};

type TeamSpec = { name: string; tag: string; players: PlayerSpec[] };

const TEAMS = {
  ndu: {
    name: "Ñandú Esports",
    tag: "NDU",
    players: [
      { handle: "tomi", name: "Tomás Ferreyra", riot: "Tomi Ñandú#LAS", rank: "DIAMOND IV 12" },
      { handle: "juli", name: "Julieta Sosa", riot: "Juli Bot#LAS", rank: "EMERALD I 80" },
      { handle: "facu", name: "Facundo Ríos", riot: "Facu Jungla#LAS", rank: "EMERALD II 55" },
      { handle: "vale", name: "Valentina Paz", riot: "Valen Supp#ARG", rank: "EMERALD II 20" },
      { handle: "lauti", name: "Lautaro Gómez", riot: "Lauti Top#LAS", rank: "EMERALD III 41" },
      { handle: "ciro", name: "Ciro Medina", riot: "Ciro Flex#LAS", rank: "EMERALD IV 3" },
    ],
  },
  pdb: {
    name: "Los Pibes del Barón",
    tag: "PDB",
    players: [
      { handle: "nacho", name: "Ignacio Herrera", riot: "Nacho Barón#LAS", rank: "EMERALD III 60" },
      { handle: "agus", name: "Agustina Molina", riot: "Agus Mid#LAS", rank: "PLATINUM I 75", peak: "EMERALD II 10" },
      { handle: "santi", name: "Santiago Ruiz", riot: "Santi Kha#LAS", rank: "PLATINUM II 33" },
      { handle: "mica", name: "Micaela Torres", riot: "Mica Lulu#LAS", rank: "EMERALD IV 0" },
      { handle: "bauti", name: "Bautista Ponce", riot: "Bauti ADC#7777", rank: "PLATINUM I 50" },
      { handle: "leo", name: "Leonel Díaz", riot: "Leo Sub#LAS", rank: "PLATINUM III 12" },
    ],
  },
  mate: {
    name: "Mate Amargo",
    tag: "MATE",
    players: [
      { handle: "pato", name: "Patricio Vera", riot: "Patoruzú#LAS", rank: "PLATINUM IV 22" },
      { handle: "caro", name: "Carolina Funes", riot: "Caro Seraphine#LAS", rank: "GOLD I 88" },
      { handle: "gonza", name: "Gonzalo Acosta", riot: "Gonza Lee#LAS", rank: "PLATINUM III 5" },
      { handle: "male", name: "Malena Ibarra", riot: "Male Thresh#LAS", rank: "GOLD II 40" },
      { handle: "dante", name: "Dante Luna", riot: "Dante Jinx#LAS", rank: "GOLD I 12" },
      { handle: "fede", name: "Federico Castro", riot: "Fede Sub#LAS", rank: "GOLD III 70" },
    ],
  },
  frn: {
    name: "Fernet con Coca",
    tag: "FRN",
    players: [
      { handle: "rodri", name: "Rodrigo Quiroga", riot: "Rodri Fernet#LAS", rank: "EMERALD II 18" },
      { handle: "sol", name: "Sol Benítez", riot: "Sol Ahri#LAS", rank: "EMERALD III 64" },
      { handle: "maxi", name: "Maximiliano Ortiz", riot: "Maxi Viego#LAS", rank: "EMERALD I 2" },
      { handle: "ana", name: "Ana Lucero", riot: "Ana Nami#LAS", rank: "EMERALD IV 51" },
      { handle: "joaco", name: "Joaquín Rojas", riot: "Joaco KaiSa#LAS", rank: "EMERALD III 30" },
      { handle: "emi", name: "Emiliano Sáez", riot: "Emi Flex#LAS", rank: "EMERALD IV 9" },
    ],
  },
  can: {
    name: "Club Atlético Nexo",
    tag: "CAN",
    players: [
      { handle: "kevo", name: "Kevin Arias", riot: "Kevo#LAS", rank: "MASTER 145", level: 412, games: 640 },
      { handle: "flor", name: "Florencia Godoy", riot: "Flor Syndra#LAS", rank: "DIAMOND IV 30" },
      { handle: "marcos", name: "Marcos Villalba", riot: "Marcos Sejuani#LAS", rank: "EMERALD I 70" },
      { handle: "abril", name: "Abril Cabrera", riot: "Abril Rell#LAS", rank: "EMERALD I 44" },
      { handle: "tobi", name: "Tobías Navarro", riot: "Tobi Ezreal#LAS", rank: "DIAMOND IV 5" },
      { handle: "rama", name: "Ramiro Paz", riot: "Rama Sub#LAS", rank: "EMERALD II 61" },
    ],
  },
  tng: {
    name: "Tango Diff",
    tag: "TNG",
    players: [
      { handle: "gaston", name: "Gastón Ledesma", riot: "Gastón Tango#LAS", rank: "PLATINUM II 47" },
      { handle: "euge", name: "Eugenia Romero", riot: "Euge Lux#LAS", rank: "PLATINUM III 15" },
      { handle: "nahuel", name: "Nahuel Correa", riot: "Nahuel Graves#LAS", rank: "PLATINUM I 90" },
      { handle: "pili", name: "Pilar Aguirre", riot: "Pili Milio#LAS", rank: "PLATINUM IV 66" },
      { handle: "franco", name: "Franco Duarte", riot: "Franco Vayne#LAS", rank: "PLATINUM II 8" },
      { handle: "uriel", name: "Uriel Méndez", riot: "Uriel Sub#LAS", rank: "PLATINUM IV 0" },
    ],
  },
  asd: {
    name: "Asado a las Doce",
    tag: "ASD",
    players: [
      { handle: "chino", name: "Martín Sánchez", riot: "Chino Asador#LAS", rank: "GOLD III 50" },
      { handle: "luli", name: "Luciana Peralta", riot: "Luli Annie#LAS", rank: "SILVER I 77" },
      { handle: "hernan", name: "Hernán Ojeda", riot: "Hernán Amumu#LAS", rank: "GOLD IV 10" },
      { handle: "belu", name: "Belén Figueroa", riot: "Belu Soraka#LAS", rank: "SILVER II 34" },
      { handle: "tincho", name: "Martín Álvarez", riot: "Tincho MF#LAS", rank: "GOLD IV 0" },
      { handle: "pipo", name: "Felipe Ramos", riot: "Pipo Nuevo#LAS", rank: null, level: 34, games: 0 },
    ],
  },
  rch: {
    name: "Riachuelo Rift",
    tag: "RCH",
    players: [
      { handle: "dario", name: "Darío Coronel", riot: "Dario Riachuelo#LAS", rank: "GOLD I 70" },
      { handle: "yami", name: "Yamila Cáceres", riot: "Yami Zoe#LAS", rank: "GOLD II 25" },
      { handle: "eze", name: "Ezequiel Moreno", riot: "Eze Nocturne#LAS", rank: "GOLD I 40" },
      { handle: "ro", name: "Rocío Vega", riot: "Ro Karma#LAS", rank: "GOLD III 12" },
      { handle: "lucas", name: "Lucas Pereyra", riot: "Lucas Caitlyn#LAS", rank: "PLATINUM IV 3" },
      { handle: "brian", name: "Brian Giménez", riot: "Brian Sub#LAS", rank: "GOLD II 58" },
    ],
  },
  gdn: {
    name: "Gauchos del Norte",
    tag: "GDN",
    players: [
      { handle: "ale", name: "Alejandro Mamaní", riot: "Ale Gaucho#ARG", rank: "EMERALD IV 33" },
      { handle: "ceci", name: "Cecilia Choque", riot: "Ceci Orianna#ARG", rank: "PLATINUM I 20" },
      { handle: "seba", name: "Sebastián Flores", riot: "Seba Kindred#ARG", rank: "PLATINUM II 71" },
      { handle: "mili", name: "Milagros Cruz", riot: "Mili Nautilus#ARG", rank: "PLATINUM I 5" },
      { handle: "elias", name: "Elías Tolaba", riot: "Elías Draven#ARG", rank: "EMERALD IV 14" },
      { handle: "javi", name: "Javier Guzmán", riot: "Javi Sub#ARG", rank: "PLATINUM III 39" },
    ],
  },
  cba: {
    name: "Cordobeses Unidos",
    tag: "CBA",
    players: [
      { handle: "fer", name: "Fernando Bustos", riot: "Fer Cuarteto#CBA", rank: "PLATINUM III 12" },
      { handle: "vicky", name: "Victoria Oviedo", riot: "Vicky Janna#CBA", rank: "SILVER I 60" },
      { handle: "nico", name: "Nicolás Paredes", riot: "Nico Hecarim#CBA", rank: "GOLD II 22" },
      { handle: "jaz", name: "Jazmín Ferrero", riot: "Jaz Yuumi#CBA", rank: "SILVER III 81" },
      { handle: "cami", name: "Camila Oliva", riot: "Cami Ashe#CBA", rank: "GOLD III 45" },
      { handle: "pablo", name: "Pablo Heredia", riot: "Pablo Sub#CBA", rank: "SILVER II 7" },
    ],
  },
} satisfies Record<string, TeamSpec>;

type TeamKey = keyof typeof TEAMS;

const FREE_AGENTS: PlayerSpec[] = [
  { handle: "rena", name: "Renata Silva", riot: "Rena Top#LAS", rank: "PLATINUM II 30" },
  { handle: "gabo", name: "Gabriel Luna", riot: "Gabo Jg#LAS", rank: "GOLD I 64" },
  { handle: "lu", name: "Lucía Pérez", riot: "Lu Mid#LAS", rank: "EMERALD IV 18" },
  { handle: "thiago", name: "Thiago Correa", riot: "Thiago ADC#LAS", rank: "PLATINUM IV 72" },
  { handle: "sofi", name: "Sofía Ramírez", riot: "Sofi Supp#LAS", rank: "GOLD II 15" },
  { handle: "joel", name: "Joel Ávila", riot: "Joel Fill#LAS", rank: "PLATINUM III 40" },
  { handle: "iara", name: "Iara Núñez", riot: "Iara Lillia#LAS", rank: "EMERALD III 22" },
  { handle: "kiara", name: "Kiara Domínguez", riot: "Kiara Neeko#LAS", rank: "PLATINUM II 55" },
  { handle: "bruno", name: "Bruno Lezcano", riot: "Bruno RekSai#LAS", rank: "EMERALD II 12" },
  { handle: "ludmi", name: "Ludmila Sena", riot: "Ludmi Braum#LAS", rank: "GOLD III 80" },
  { handle: "tadeo", name: "Tadeo Gil", riot: "Tadeo Gnar#LAS", rank: "SILVER I 41" },
  { handle: "zoe", name: "Zoe Aranda", riot: "Zoe Senna#LAS", rank: "PLATINUM IV 9" },
];

const EDGE_CASES: PlayerSpec[] = [
  // Fails the Copa Semanal account minimums: low level, few ranked games.
  { handle: "uli", name: "Ulises Cardozo", riot: "Uli Nuevo#LAS", rank: "SILVER IV 10", level: 21, games: 9 },
  // Gold on Riot, Diamond II by a moderator's override.
  { handle: "ivo", name: "Ivo Benítez", riot: "Ivo Bajito#LAS", rank: "GOLD II 30" },
  // Signed up, never linked a Riot ID.
  { handle: "marti", name: "Martina Sin Riot" },
];

const users = new Map<string, string>(); // handle -> user id
const puuids = new Map<string, string>(); // user id -> puuid
const riotAccountIds = new Map<string, string>(); // handle -> riot account id
const handleOf = (userId: string) => [...users].find(([, v]) => v === userId)![0];
const id = (handle: string) => {
  const found = users.get(handle);
  if (!found) throw new Error(`unknown seed user ${handle}`);
  return found;
};

function parseRank(spec: string): Rank {
  const parts = spec.split(" ");
  const tier = parts[0] as Rank["tier"];
  if (!TIERS.includes(tier)) throw new Error(`bad tier in ${spec}`);
  if (parts.length === 2) return { tier, division: "I", lp: Number(parts[1]) };
  const division = parts[1] as Rank["division"];
  if (!DIVISIONS.includes(division)) throw new Error(`bad division in ${spec}`);
  return { tier, division, lp: Number(parts[2]) };
}

async function signUp(handle: string, name: string, role: "player" | "moderator" | "admin" = "player"): Promise<string> {
  const result = await auth.api.signUpEmail({ body: { name, email: `${handle}@${EMAIL_DOMAIN}`, password: PASSWORD } });
  const userId = result.user.id;
  if (role !== "player") await db.update(user).set({ role }).where(eq(user.id, userId));
  users.set(handle, userId);
  return userId;
}

async function createPlayer(spec: PlayerSpec): Promise<string> {
  const userId = await signUp(spec.handle, spec.name);
  if (!spec.riot) return userId;
  const [gameName, tagLine] = spec.riot.split("#") as [string, string];
  const puuid = `seed-puuid-${spec.handle}`;
  const [account] = await db
    .insert(riotAccounts)
    .values({
      userId,
      puuid,
      gameName,
      tagLine,
      summonerLevel: spec.level ?? between(60, 380),
      profileIconId: between(1, 28),
      linkedAt: new Date(NOW.getTime() - between(40, 200) * DAY),
      lastPolledAt: new Date(NOW.getTime() - between(1, 5) * HOUR),
    })
    .returning({ id: riotAccounts.id });
  puuids.set(userId, puuid);
  riotAccountIds.set(spec.handle, account!.id);

  const games = spec.games ?? between(60, 420);
  const wins = Math.round(games * (0.47 + rng() * 0.08));
  const current = spec.rank ? parseRank(spec.rank) : null;
  const snapshot = (rank: Rank | null, daysAgo: number, w: number, l: number) => ({
    riotAccountId: account!.id,
    tier: rank?.tier ?? null,
    division: rank?.division ?? null,
    lp: rank?.lp ?? null,
    wins: w,
    losses: l,
    observedAt: new Date(NOW.getTime() - daysAgo * DAY),
  });
  const history = [];
  // A season peak above the current rank, recorded months ago.
  if (spec.peak) history.push(snapshot(parseRank(spec.peak), 120, Math.round(wins * 0.6), Math.round((games - wins) * 0.5)));
  else if (current && games > 0) history.push(snapshot({ ...current, lp: Math.max(0, current.lp - 30) }, 30, Math.round(wins * 0.8), Math.round((games - wins) * 0.8)));
  history.push(snapshot(current, 1, wins, games - wins));
  await db.insert(rankSnapshots).values(history);
  return userId;
}

async function createTeams(): Promise<Record<TeamKey, { id: string; slug: string; members: string[] }>> {
  const out = {} as Record<TeamKey, { id: string; slug: string; members: string[] }>;
  for (const [key, spec] of Object.entries(TEAMS) as [TeamKey, TeamSpec][]) {
    const members = [];
    for (const p of spec.players) members.push(await createPlayer(p));
    const created = must(`createTeam ${spec.name}`, await createTeam(db, members[0]!, { name: spec.name, tag: spec.tag }));
    await db
      .insert(teamMembers)
      .values(members.slice(1).map((userId) => ({ teamId: created.teamId, userId, role: "member" as const })));
    out[key] = { id: created.teamId, slug: created.slug, members };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Tournaments.

const RULES_TEXT = `## Formato
Eliminación según el cuadro publicado. Partidas al mejor de 1; la final al mejor de 3.

## Draft
Tournament Draft desde el cliente. El equipo de seed más alto elige lado en el primer juego.

## Puntualidad
Check-in obligatorio una hora antes. Un equipo con menos de tres jugadores presentes pierde por W.O.

## Conducta
Cero tolerancia con insultos o abandono intencional. Las decisiones de los moderadores son finales.`;

const PAYMENT_TEXT = "Transferí la inscripción al alias **gorosei.copa** (Mercado Pago) y mandá el comprobante por Discord con tu Riot ID.";

const semanalRules: EligibilityRule[] = [
  { id: "tope-diamante", type: "player_rank_range", max: { tier: "DIAMOND", division: "IV" } },
  { id: "cuenta-minima", type: "account_minimums", minLevel: 30, minRankedGames: 20 },
];

function cupInput(overrides: Partial<TournamentInput> & Pick<TournamentInput, "title" | "edition" | "startsAt">): TournamentInput {
  return {
    registrationClosesAt: new Date(overrides.startsAt.getTime() - DAY),
    bracket: "double_elimination",
    draftMode: "tournament_draft",
    bestOf: 1,
    finalsBestOf: 3,
    teamCap: 8,
    maxSubs: 1,
    subsCountForTeamRules: false,
    rankSource: "peak_season",
    eligibilityRules: semanalRules,
    entryFeeArs: 5000,
    prizeGoalArs: 300000,
    prizeSplit: [70, 30],
    paymentInstructions: PAYMENT_TEXT,
    rulesText: RULES_TEXT,
    streamUrl: "https://www.twitch.tv/gorosei",
    ...overrides,
  };
}

async function openCup(admin: string, input: TournamentInput) {
  const created = await createTournament(db, admin, input);
  must(`open ${input.title}`, await openRegistration(db, admin, created.id));
  const [row] = await db.select().from(tournaments).where(eq(tournaments.id, created.id));
  return row!;
}

type Cup = Awaited<ReturnType<typeof openCup>>;
type SeedTeams = Awaited<ReturnType<typeof createTeams>>;

/**
 * Registers the team with its first five members as starters and the sixth as sub. ASD's sub is unranked with no
 * ranked games, so under the Copa Semanal account minimums ASD registers with `sub: false`.
 */
async function register(cup: Cup, team: SeedTeams[TeamKey], opts: { starters?: number; sub?: boolean } = {}) {
  const starters = team.members.slice(0, opts.starters ?? 5);
  const subs = opts.sub === false || cup.maxSubs === 0 ? [] : team.members.slice(5, 6);
  const result = await registerTeam(deps, team.members[0]!, cup.id, team.id, { starters, subs });
  return must(`register ${team.slug} in ${cup.slug}`, result).registrationId;
}

let paymentRef = 48210;
async function pay(admin: string, cup: Cup, userIds: string[]) {
  for (const userId of userIds) must(`markPaid in ${cup.slug}`, await markPaid(db, admin, cup.id, [userId], `MP #${paymentRef++}`));
}

/** Opens check-in, checks every roster in with a time inside the window and starts the bracket. */
async function startCup(cup: Cup, checkedIn: Map<string, string[]>) {
  must(`openCheckIn ${cup.slug}`, await openCheckIn(db, cup.id, new Date(cup.startsAt.getTime() - 55 * MINUTE), null, { force: true }));
  for (const [registrationId, userIds] of checkedIn) {
    for (const userId of userIds) {
      must("checkIn", await checkIn(db, userId, registrationId, new Date(cup.startsAt.getTime() - between(20, 50) * MINUTE)));
    }
  }
  must(`closeCheckIn ${cup.slug}`, await closeCheckIn(db, cup.id, new Date(cup.startsAt.getTime() - 10 * MINUTE), null));
}

async function captainOf(registrationId: string): Promise<string> {
  const [row] = await db
    .select({ captain: teams.captainUserId })
    .from(registrations)
    .innerJoin(teams, eq(teams.id, registrations.teamId))
    .where(eq(registrations.id, registrationId));
  return row!.captain;
}

async function openMatches(cupId: string) {
  return db
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, cupId), eq(matches.status, "open")))
    .orderBy(asc(matches.groupNo), asc(matches.roundNo), asc(matches.number));
}

function scoreFor(bestOf: 1 | 3 | 5, side1Wins: boolean) {
  const needed = Math.ceil(bestOf / 2);
  const loser = between(0, needed - 1);
  return side1Wins ? { score1: needed, score2: loser } : { score1: loser, score2: needed };
}

type Match = typeof matches.$inferSelect;

/** Both captains report the same score, then a moderator confirms it. */
async function reportAndConfirm(mod: string, match: Match, score: { score1: number; score2: number }) {
  const ids = [`LA2_${between(1500000000, 1599999999)}`];
  const c1 = await captainOf(match.reg1Id!);
  const c2 = await captainOf(match.reg2Id!);
  must("report 1", await reportResult(db, c1, match.id, { own: score.score1, opponent: score.score2, screenshotUrl: null, riotMatchIds: ids }));
  must("report 2", await reportResult(db, c2, match.id, { own: score.score2, opponent: score.score1, screenshotUrl: null, riotMatchIds: ids }));
  must("confirm", await confirmMatch(db, mod, match.id));
}

const waves = new Map<string, number>(); // match id -> round of play, for backdating

/** Plays every open match until the bracket is done; `side1Wins` decides each match. */
async function playOut(mod: string, cup: Cup, side1Wins: (m: Match) => boolean) {
  for (let wave = 0; ; wave++) {
    const open = await openMatches(cup.id);
    if (open.length === 0) return;
    for (const m of open) {
      waves.set(m.id, wave);
      const score = scoreFor(m.bestOf, side1Wins(m));
      if (rng() < 0.7) await reportAndConfirm(mod, m, score);
      else must("confirm override", await confirmMatch(db, mod, m.id, score));
    }
  }
}

/** Moves a played cup's match, report and chat times to when it was played instead of when the seed ran. */
async function backdate(cup: Cup) {
  const rows = await db.select().from(matches).where(eq(matches.tournamentId, cup.id));
  for (const m of rows) {
    const wave = waves.get(m.id);
    if (wave === undefined) continue;
    const openedAt = new Date(cup.startsAt.getTime() + wave * 55 * MINUTE);
    const confirmedAt = m.confirmedAt ? new Date(openedAt.getTime() + between(32, 48) * MINUTE) : null;
    await db.update(matches).set({ openedAt, ...(confirmedAt ? { confirmedAt } : {}) }).where(eq(matches.id, m.id));
    if (confirmedAt) {
      await db.update(matchReports).set({ createdAt: new Date(confirmedAt.getTime() - 4 * MINUTE), updatedAt: new Date(confirmedAt.getTime() - 4 * MINUTE) }).where(eq(matchReports.matchId, m.id));
    }
    const messages = await db.select({ id: matchMessages.id }).from(matchMessages).where(eq(matchMessages.matchId, m.id)).orderBy(asc(matchMessages.createdAt));
    for (const [i, message] of messages.entries()) {
      await db.update(matchMessages).set({ createdAt: new Date(openedAt.getTime() + (i + 1) * 3 * MINUTE) }).where(eq(matchMessages.id, message.id));
    }
  }
  await db.update(registrations).set({ createdAt: new Date(cup.registrationClosesAt.getTime() - 3 * DAY) }).where(eq(registrations.tournamentId, cup.id));
}

async function strengthOf(cupId: string): Promise<Map<string, number>> {
  const rows = await db.execute<{ registration_id: string; strength: number }>(sql`
    select registration_id, avg(
      case snapshot->'rank'->>'tier'
        when 'IRON' then 0 when 'BRONZE' then 4 when 'SILVER' then 8 when 'GOLD' then 12 when 'PLATINUM' then 16
        when 'EMERALD' then 20 when 'DIAMOND' then 24 else 28 end)::float as strength
    from registration_players where tournament_id = ${cupId} and active and not is_sub group by registration_id`);
  return new Map([...rows].map((r) => [r.registration_id, r.strength]));
}

/** The stronger team usually wins; one match in four is an upset. */
async function favourites(cupId: string) {
  const strength = await strengthOf(cupId);
  return (m: Match) => {
    const s1 = strength.get(m.reg1Id!) ?? 0;
    const s2 = strength.get(m.reg2Id!) ?? 0;
    return rng() < 0.25 ? s1 < s2 : s1 >= s2;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Match stats from fake Riot games.

const CHAMPIONS: Record<string, string[]> = {
  TOP: ["Aatrox", "Gnar", "KSante", "Renekton", "Jax", "Ornn"],
  JUNGLE: ["LeeSin", "Viego", "Sejuani", "Graves", "Kindred", "Maokai"],
  MIDDLE: ["Ahri", "Orianna", "Syndra", "Azir", "Sylas", "Taliyah"],
  BOTTOM: ["Jinx", "KaiSa", "Ezreal", "Varus", "Caitlyn", "Xayah"],
  UTILITY: ["Thresh", "Nautilus", "Lulu", "Rell", "Milio", "Rakan"],
};
const POSITIONS = Object.keys(CHAMPIONS);

async function rosterPuuids(registrationId: string): Promise<string[]> {
  const rows = await db.execute<{ user_id: string }>(sql`
    select user_id from registration_players where registration_id = ${registrationId} and active and not is_sub`);
  return [...rows].map((r) => puuids.get(r.user_id)).filter((p): p is string => !!p);
}

async function fakeGame(match: Match, side1Wins: boolean): Promise<string> {
  const matchId = `LA2_${between(1600000000, 1699999999)}`;
  const blue = await rosterPuuids(match.reg1Id!);
  const red = await rosterPuuids(match.reg2Id!);
  const player = (puuid: string, teamId: 100 | 200, i: number, won: boolean) => ({
    puuid,
    teamId,
    championName: pick(CHAMPIONS[POSITIONS[i]!]!),
    kills: won ? between(2, 11) : between(0, 6),
    deaths: won ? between(0, 4) : between(2, 8),
    assists: won ? between(4, 16) : between(1, 9),
    role: POSITIONS[i]!,
  });
  const game: RiotMatch = {
    matchId,
    durationSeconds: between(1500, 2300),
    winningTeamId: side1Wins ? 100 : 200,
    teams: [
      { teamId: 100, win: side1Wins, bans: [between(1, 200), between(1, 200), between(1, 200)] },
      { teamId: 200, win: !side1Wins, bans: [between(1, 200), between(1, 200), between(1, 200)] },
    ],
    players: [...blue.map((p, i) => player(p, 100, i, side1Wins)), ...red.map((p, i) => player(p, 200, i, !side1Wins))],
  };
  riot.addMatch(game);
  return matchId;
}

async function attachStats(mod: string, matchId: string) {
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!m || m.score1 === null || m.score2 === null) return;
  const games: string[] = [];
  // One game per map played, the winner of the series taking the last one.
  const side1Won = m.score1 > m.score2;
  const order = [...Array(m.score1).fill(true), ...Array(m.score2).fill(false)].sort(() => rng() - 0.5);
  const last = order.lastIndexOf(side1Won);
  [order[last], order[order.length - 1]] = [order[order.length - 1], order[last]];
  for (const won of order.slice(0, 3)) games.push(await fakeGame(m, won));
  must("attach stats", await attachRiotMatchIds(deps, { id: mod, role: "moderator" }, matchId, games));
}

async function chat(matchId: string, lines: [string | "mod", string][], mod: string) {
  for (const [who, body] of lines) {
    const author = who === "mod" ? { id: mod, role: "moderator" as const } : { id: id(who), role: "player" as const };
    must(`chat ${who}`, await postMessage(db, author, matchId, body));
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Recurring templates.

type Schedule = Pick<TemplateInput, "weekday" | "startTime" | "registrationOpensDaysBefore" | "registrationClosesMinutesBefore" | "active">;

/** A template copied from its latest edition, with every edition linked to it as if the job had created them. */
async function recurring(admin: string, editions: Cup[], schedule: Schedule) {
  const latest = editions.at(-1)!;
  const template = await createTemplate(db, admin, templateInputSchema.parse({ ...latest, ...schedule, nextEdition: latest.edition + 1 }));
  await db.update(tournaments).set({ templateId: template.id }).where(inArray(tournaments.id, editions.map((e) => e.id)));
}

// ---------------------------------------------------------------------------------------------------------------
// Notifications.

/**
 * Seeding notifies at the moment it runs. Moves each notification to when its event happened in the story, marks
 * what is over a day old read, and keeps the outbox from mailing any of it to `@gorosei.test`.
 */
async function settleNotifications() {
  await db.execute(sql`
    update notifications n set created_at = m.opened_at from matches m
    where n.kind = 'match_ready' and m.id::text = n.payload->>'matchId' and m.opened_at is not null`);
  await db.execute(sql`
    update notifications n set created_at = m.confirmed_at + interval '1 minute' from matches m
    where n.kind = 'result_confirmed' and m.id::text = n.payload->>'matchId' and m.confirmed_at is not null`);
  // Cups already under way: check-in opened 55 minutes before the start; payments landed three days before
  // registration closed, confirmations the day after.
  await db.execute(sql`
    update notifications n set created_at = t.starts_at - interval '55 minutes' from tournaments t
    where n.kind = 'check_in_open' and t.slug = n.payload->'tournament'->>'slug' and t.starts_at < now()`);
  await db.execute(sql`
    update notifications n
    set created_at = t.registration_closes_at - case n.kind when 'payment_recorded' then interval '3 days' else interval '2 days' end
      + random() * interval '1 day'
    from tournaments t
    where n.kind in ('payment_recorded', 'registration_confirmed') and t.slug = n.payload->'tournament'->>'slug' and t.starts_at < now()`);
  await db.execute(sql`update notifications set read_at = created_at + interval '2 hours' where created_at < now() - interval '1 day'`);
  await db.update(notifications).set({ emailStatus: "skipped" });
}

// ---------------------------------------------------------------------------------------------------------------
// Reset.

async function reset() {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error(`refusing to seed a non-local database (${url.hostname})`);
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.execute(sql`
    truncate match_messages, match_reports, matches, brackets, check_ins, pool_entries, entry_payments, entry_credits,
      eligibility_exceptions, registration_players, registrations, team_requests, team_members, teams, tournaments,
      tournament_templates, notifications, audit_log`);
  const seeded = db.select({ id: user.id }).from(user).where(like(user.email, `%@${EMAIL_DOMAIN}`));
  await db.delete(notificationSettings).where(inArray(notificationSettings.userId, seeded));
  const seededAccounts = db.select({ id: riotAccounts.id }).from(riotAccounts).where(inArray(riotAccounts.userId, seeded));
  await db.execute(sql`delete from rank_overrides where riot_account_id in (${seededAccounts}) or set_by in (${seeded})`);
  await db.delete(rankSnapshots).where(inArray(rankSnapshots.riotAccountId, seededAccounts));
  await db.execute(sql`delete from riot_link_challenges where user_id in (${seeded})`);
  await db.delete(riotAccounts).where(inArray(riotAccounts.userId, seeded));
  await db.delete(user).where(like(user.email, `%@${EMAIL_DOMAIN}`));
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  console.log("Resetting competition data and earlier seed users…");
  await reset();

  console.log("Creating staff, players and teams…");
  const admin = await signUp("admin", "Sofía Admin", "admin");
  const mod = await signUp("mod", "Nico Moderador", "moderator");
  const T = await createTeams();
  for (const p of [...FREE_AGENTS, ...EDGE_CASES]) await createPlayer(p);
  await setRankOverride(db, admin, riotAccountIds.get("ivo")!, { tier: "DIAMOND", division: "II" }, "Cuenta secundaria de un jugador Diamante II confirmada por Discord.");

  // A small team still forming: a pending join request and a pending invite.
  const inm = must("createTeam INM", await createTeam(db, id("ivo"), { name: "Los Inmortales", tag: "INM" }));
  must("join request", await requestToJoin(db, id("uli"), inm.teamId));
  must("invite", await inviteByRiotId(db, id("ivo"), inm.teamId, "Tadeo Gnar#LAS"));
  must("join request TNG", await requestToJoin(db, id("zoe"), T.tng.id));

  // ---- Copa Otoño #1: finished a month ago, double elimination with four teams, decided in the bracket reset.
  console.log("Copa Otoño #1 (finished, double elimination, bracket reset)…");
  const otono = await openCup(admin, cupInput({ title: "Copa Otoño", edition: 1, startsAt: art(-35, 18), entryFeeArs: 0, prizeGoalArs: 0, prizeSplit: [100], eligibilityRules: [] }));
  const otonoRegs = new Map<string, string[]>();
  for (const key of ["ndu", "mate", "tng", "gdn"] as const) otonoRegs.set(await register(otono, T[key]), T[key].members.slice(0, 5));
  must("close otoño", await closeRegistration(db, otono.id, otono.registrationClosesAt, null));
  await startCup(otono, otonoRegs);
  const otonoFav = await favourites(otono.id);
  // The losers-bracket team wins grand final 1, forcing the reset.
  await playOut(mod, otono, (m) => (m.phase === "grand_final" ? false : otonoFav(m)));
  await backdate(otono);

  // ---- Copa Semanal LAS #1: finished two weeks ago, single elimination with eight teams and a third-place match.
  console.log("Copa Semanal LAS #1 (finished, single elimination)…");
  const s1 = await openCup(admin, cupInput({ title: "Copa Semanal LAS", edition: 1, startsAt: art(-14, 18), bracket: "single_elimination" }));
  const s1Regs = new Map<string, string[]>();
  for (const key of ["ndu", "pdb", "mate", "frn", "tng", "asd", "rch", "gdn"] as const) {
    const reg = await register(s1, T[key], { sub: key !== "asd" });
    await pay(admin, s1, T[key].members.slice(0, 5));
    s1Regs.set(reg, T[key].members.slice(0, 5));
  }
  must("close s1", await closeRegistration(db, s1.id, s1.registrationClosesAt, null));
  await startCup(s1, s1Regs);
  await playOut(mod, s1, await favourites(s1.id));
  const s1Matches = await db.select().from(matches).where(eq(matches.tournamentId, s1.id));
  const s1Final = s1Matches.find((m) => m.phase === "final")!;
  await chat(s1Final.id, [["mod", "Lobby de la final listo, revisen el lado en el draft."], [handleOf(await captainOf(s1Final.reg1Id!)), "Listos de nuestro lado 👍"], [handleOf(await captainOf(s1Final.reg2Id!)), "GG, nos vemos en la próxima"], ["mod", "GG a los dos equipos, ¡terrible final!"]], mod);
  await attachStats(mod, s1Final.id);
  must("vod final", await setMatchVod(db, mod, s1Final.id, "https://www.youtube.com/watch?v=gorosei-s1-final"));
  for (const semi of s1Matches.filter((m) => m.phase === "main" && m.roundNo === 2)) {
    must("vod semi", await setMatchVod(db, mod, semi.id, `https://www.twitch.tv/videos/20261008${semi.number}`));
  }
  await backdate(s1);

  // ---- Copa Primavera #1: cancelled after payments; every payer got a credit.
  console.log("Copa Primavera #1 (cancelled, credits)…");
  const primavera = await openCup(admin, cupInput({ title: "Copa Primavera", edition: 1, startsAt: art(-4, 18) }));
  await register(primavera, T.mate);
  await pay(admin, primavera, T.mate.members.slice(0, 5));
  await register(primavera, T.asd, { sub: false });
  await pay(admin, primavera, T.asd.members.slice(0, 2));
  must("cancel primavera", await cancelTournament(db, admin, primavera.id, "Corte de luz en el servidor de LAS durante el fin de semana."));

  // Manual credits: one live, one revoked.
  await grantManualCredit(db, admin, id("gabo"), "Compensación por la caída del cliente en la Copa Semanal #1.");
  const wrong = await grantManualCredit(db, admin, id("tadeo"), "Otorgado por error.");
  must("revoke", await revokeCredit(db, admin, wrong.creditId));

  // ---- Copa Semanal LAS #2: live right now, double elimination with eight teams and every match state.
  console.log("Copa Semanal LAS #2 (live, every match state)…");
  const liveStart = new Date(Math.floor((NOW.getTime() - 2 * HOUR) / (5 * MINUTE)) * 5 * MINUTE);
  const s2 = await openCup(admin, cupInput({ title: "Copa Semanal LAS", edition: 2, startsAt: liveStart, registrationClosesAt: new Date(liveStart.getTime() - DAY) }));
  const s2Regs = new Map<string, string[]>();
  for (const key of ["pdb", "mate", "frn", "can", "tng", "asd", "rch", "gdn"] as const) {
    // CAN's Master captain plays under an exception to the Diamond cap.
    if (key === "can") await grantEligibilityException(db, admin, { tournamentId: s2.id, teamId: T.can.id, ruleId: "tope-diamante", reason: "Invitados por la organización: el capitán juega en Master." });
    const reg = await register(s2, T[key], { sub: key !== "asd" });
    await pay(admin, s2, T[key].members.slice(0, 5));
    s2Regs.set(reg, T[key].members.slice(0, 5));
  }
  must("close s2", await closeRegistration(db, s2.id, s2.registrationClosesAt, null));
  await startCup(s2, s2Regs);
  const s2Fav = await favourites(s2.id);
  // Winners round 1: two through captain reports, one moderator override, one forfeit.
  const wr1 = await openMatches(s2.id);
  for (const [i, m] of wr1.entries()) {
    waves.set(m.id, 0);
    if (i === 0 || i === 2) await reportAndConfirm(mod, m, scoreFor(1, s2Fav(m)));
    else if (i === 1) must("override", await confirmMatch(db, mod, m.id, scoreFor(1, s2Fav(m))));
    else must("forfeit", await forfeitMatch(db, mod, m.id, m.reg2Id!));
  }
  // Next wave: winners round 2 and losers round 1.
  const next = await openMatches(s2.id);
  const winners = next.filter((m) => m.phase === "winners");
  const losers = next.filter((m) => m.phase === "losers");
  for (const m of next) waves.set(m.id, 1);
  await backdate(s2);
  // Completed, with stats and a VOD.
  await reportAndConfirm(mod, winners[0]!, scoreFor(1, true));
  waves.set(winners[0]!.id, 1);
  await attachStats(mod, winners[0]!.id);
  must("vod live", await setMatchVod(db, mod, winners[0]!.id, "https://www.twitch.tv/videos/2026102201"));
  // In progress with a lobby, a chat and running late.
  const playing = winners[1]!;
  must("lobby", await postLobby(db, mod, playing.id, { name: "GOROSEI S2 WB2", password: "mate123" }));
  const c1 = await captainOf(playing.reg1Id!);
  const c2 = await captainOf(playing.reg2Id!);
  await chat(playing.id, [["mod", "Lobby arriba. Tienen 10 minutos para entrar."], [handleOf(c1), "Estamos todos adentro"], [handleOf(c2), "Nos falta el jungla, se le cayó internet 😩"], ["mod", "Les doy 5 minutos más, después arranca el draft."]], mod);
  await db.update(matches).set({ openedAt: new Date(NOW.getTime() - 80 * MINUTE) }).where(eq(matches.id, playing.id));
  // Reported through Riot: played on a tournament code, the result callback scored it, one captain agrees.
  const reported = losers[0]!;
  await db.update(matches).set({ tournamentCode: "LA204d2-6f1c8e0a-3b7d-4c55-9a12-gorosei0lb1", status: "in_progress" }).where(eq(matches.id, reported.id));
  must("report a", await reportResult(db, await captainOf(reported.reg1Id!), reported.id, { own: 1, opponent: 0, screenshotUrl: "https://i.imgur.com/gorosei-lb1.png", riotMatchIds: [] }));
  must("riot callback", await attachVerifiedRiotMatchIds(deps, null, reported.id, [await fakeGame(reported, true)]));
  // Disputed: both captains claim the win.
  const disputed = losers[1]!;
  const d1 = await captainOf(disputed.reg1Id!);
  const d2 = await captainOf(disputed.reg2Id!);
  must("dispute a", await reportResult(db, d1, disputed.id, { own: 1, opponent: 0, screenshotUrl: "https://i.imgur.com/gorosei-d1.png", riotMatchIds: [] }));
  must("dispute b", await reportResult(db, d2, disputed.id, { own: 1, opponent: 0, screenshotUrl: "https://i.imgur.com/gorosei-d2.png", riotMatchIds: [] }));
  await chat(disputed.id, [[handleOf(d1), "Ganamos nosotros, el nexo cayó a los 28 minutos."], [handleOf(d2), "Remakeamos por desconexión, no cuenta."], ["mod", "Estoy revisando las capturas, no reporten de nuevo."]], mod);

  // ---- Copa Nocturna #1: check-in is open right now; the bracket starts by itself 35 minutes after seeding.
  console.log("Copa Nocturna #1 (check-in open)…");
  const nightStart = new Date(Math.ceil((NOW.getTime() + 45 * MINUTE) / (5 * MINUTE)) * 5 * MINUTE);
  const night = await openCup(admin, cupInput({ title: "Copa Nocturna", edition: 1, startsAt: nightStart, registrationClosesAt: new Date(nightStart.getTime() - 3 * HOUR), entryFeeArs: 3000, prizeGoalArs: 100000, prizeSplit: [100], bracket: "single_elimination", eligibilityRules: [] }));
  const nightRegs: Partial<Record<TeamKey, string>> = {};
  for (const key of ["ndu", "asd", "rch", "cba", "tng"] as const) {
    nightRegs[key] = await register(night, T[key]);
    if (key !== "tng") await pay(admin, night, T[key].members.slice(0, 5));
  }
  must("close night", await closeRegistration(db, night.id, NOW, null));
  must("open check-in", await openCheckIn(db, night.id, NOW, null));
  const checkInNow = new Date();
  for (const userId of T.ndu.members.slice(0, 6)) must("checkIn ndu", await checkIn(db, userId, nightRegs.ndu!, checkInNow));
  for (const userId of T.asd.members.slice(0, 3)) must("checkIn asd", await checkIn(db, userId, nightRegs.asd!, checkInNow));
  for (const userId of T.rch.members.slice(0, 4)) must("checkIn rch", await checkIn(db, userId, nightRegs.rch!, checkInNow));
  must("short-handed", await decideShortHanded(db, T.rch.members[0]!, nightRegs.rch!, "play", checkInNow));

  // ---- Copa Semanal LAS #3: registration closed yesterday, starts in two days; the pool became a team.
  console.log("Copa Semanal LAS #3 (registration closed, auto-placed team, credits)…");
  const s3 = await openCup(admin, cupInput({ title: "Copa Semanal LAS", edition: 3, startsAt: art(2, 18), registrationClosesAt: new Date(NOW.getTime() - 2 * HOUR) }));
  for (const key of ["ndu", "mate", "frn", "tng"] as const) {
    await register(s3, T[key]);
    await pay(admin, s3, T[key].members.slice(0, 5));
  }
  await register(s3, T.cba);
  await pay(admin, s3, T.cba.members.slice(0, 3));
  const s3Pool: [string, Role[], boolean][] = [
    ["rena", ["top", "jungle"], true],
    ["gabo", ["jungle"], true],
    ["lu", ["mid", "top"], true],
    ["thiago", ["bot"], true],
    ["sofi", ["support", "bot"], true],
    ["joel", ["mid", "jungle", "top", "bot", "support"], true],
    ["iara", ["jungle", "top"], false],
  ];
  for (const [handle, roles, autoPlace] of s3Pool) {
    await pay(admin, s3, [id(handle)]);
    must(`pool ${handle}`, await enterPool(deps, id(handle), s3.id, { roles, autoPlace }));
  }
  must("close s3", await closeRegistration(db, s3.id, NOW, null));

  // ---- Copa Semanal LAS #4: open, the featured cup: confirmed, pending, open and withdrawn teams plus a pool.
  console.log("Copa Semanal LAS #4 (registration open, pool)…");
  const s4 = await openCup(admin, cupInput({ title: "Copa Semanal LAS", edition: 4, startsAt: art(9, 18) }));
  await register(s4, T.pdb);
  await pay(admin, s4, T.pdb.members.slice(0, 5));
  // MATE pays with the credits Copa Primavera's cancellation left them.
  await register(s4, T.mate);
  const credits = await db.select().from(entryCredits).where(and(eq(entryCredits.sourceTournamentId, primavera.id), eq(entryCredits.status, "available")));
  for (const credit of credits.filter((c) => T.mate.members.includes(c.userId))) must("applyCredit", await applyCredit(db, admin, credit.id, s4.id));
  await grantEligibilityException(db, admin, { tournamentId: s4.id, teamId: T.can.id, ruleId: "tope-diamante", reason: "Invitados por la organización: el capitán juega en Master." });
  await register(s4, T.can);
  await pay(admin, s4, T.can.members.slice(0, 5));
  await register(s4, T.rch);
  await pay(admin, s4, T.rch.members.slice(0, 3));
  const tngReg = await register(s4, T.tng);
  must("withdraw", await withdrawRegistration(db, T.tng.members[0]!, tngReg));
  const gdnReg = await register(s4, T.gdn, { starters: 4, sub: false });
  await pay(admin, s4, T.gdn.members.slice(0, 4));
  const s4Pool: [string, Role[], boolean][] = [
    ["kiara", ["mid", "support"], true],
    ["bruno", ["jungle"], true],
    ["ludmi", ["support"], false],
    ["tadeo", ["top"], true],
    ["zoe", ["bot", "support"], true],
    ["joel", ["mid", "jungle", "top", "bot", "support"], true],
  ];
  for (const [handle, roles, autoPlace] of s4Pool) {
    await pay(admin, s4, [id(handle)]);
    must(`pool ${handle}`, await enterPool(deps, id(handle), s4.id, { roles, autoPlace }));
  }
  // Iara's unplaced credit from #3 pays her way into this pool.
  const [iaraCredit] = await db.select().from(entryCredits).where(and(eq(entryCredits.userId, id("iara")), eq(entryCredits.status, "available")));
  if (iaraCredit) must("iara credit", await applyCredit(db, admin, iaraCredit.id, s4.id));
  must("pool iara", await enterPool(deps, id("iara"), s4.id, { roles: ["jungle", "top"], autoPlace: true }));
  must("pool request", await requestFromPool(db, id("kiara"), gdnReg));
  must("pool recruit", await recruitFromPool(db, T.gdn.members[0]!, gdnReg, id("bruno")));

  // ---- Copa Diamante #1: open, free, current rank, cap of four already full with one team waitlisted.
  console.log("Copa Diamante #1 (cap full, waitlist)…");
  const diamante = await openCup(admin, cupInput({
    title: "Copa Diamante",
    edition: 1,
    startsAt: art(16, 17),
    bracket: "single_elimination",
    bestOf: 3,
    finalsBestOf: 5,
    teamCap: 4,
    maxSubs: 2,
    subsCountForTeamRules: true,
    rankSource: "current",
    entryFeeArs: 0,
    prizeGoalArs: 150000,
    prizeSplit: [60, 30, 10],
    eligibilityRules: [
      { id: "presupuesto", type: "point_budget", points: { IRON: 1, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4, EMERALD: 5, DIAMOND: 7, MASTER: 9, GRANDMASTER: 10, CHALLENGER: 10 }, unrankedPoints: 3, maxTotal: 30 },
      { id: "promedio", type: "team_average_max", max: { tier: "EMERALD", division: "I" } },
      { id: "un-diamante", type: "max_players_above", count: 1, above: { tier: "EMERALD", division: "I" } },
    ],
    paymentInstructions: "",
  }));
  for (const key of ["pdb", "frn", "tng", "gdn", "cba"] as const) await register(diamante, T[key]);

  // ---- Copa Relámpago #1: a draft only admins see.
  await createTournament(db, admin, cupInput({ title: "Copa Relámpago", edition: 1, startsAt: art(23, 20), bestOf: 1, finalsBestOf: 1, bracket: "single_elimination", teamCap: 16, entryFeeArs: 2000, prizeGoalArs: 120000, prizeSplit: [100] }));

  // ---- Recurring templates. The weekly one already made editions 1–4 and waits until #4 starts to make #5; the
  // nocturnal one is paused; Copa Federal has no edition yet, so the dev server's job creates #1 within a minute.
  console.log("Recurring templates…");
  await recurring(admin, [s1, s2, s3, s4], { ...artSchedule(s4.startsAt), registrationOpensDaysBefore: 7, registrationClosesMinutesBefore: 24 * 60, active: true });
  await recurring(admin, [night], { ...artSchedule(night.startsAt), registrationOpensDaysBefore: 3, registrationClosesMinutesBefore: 180, active: false });
  const federal = cupInput({ title: "Copa Federal", edition: 1, startsAt: NOW, bracket: "double_elimination", teamCap: 16, entryFeeArs: 4000, prizeGoalArs: 200000, prizeSplit: [60, 25, 15], eligibilityRules: [] });
  await createTemplate(db, admin, templateInputSchema.parse({ ...federal, weekday: 0, startTime: "16:00", registrationOpensDaysBefore: 7, registrationClosesMinutesBefore: 120, nextEdition: 1, active: true }));

  await setEmailEnabled(db, id("agus"), false);
  await settleNotifications();
  await summary();
}

async function summary() {
  const cups = await db.select({ slug: tournaments.slug, status: tournaments.status, startsAt: tournaments.startsAt }).from(tournaments).orderBy(asc(tournaments.startsAt));
  const regs = await db.execute<{ slug: string; status: string; n: number }>(sql`
    select t.slug, r.status, count(*)::int as n from registrations r join tournaments t on t.id = r.tournament_id group by 1, 2 order by 1, 2`);
  const byCup = new Map<string, string[]>();
  for (const r of regs) byCup.set(r.slug, [...(byCup.get(r.slug) ?? []), `${r.n} ${r.status}`]);
  const autoTeams = await db.select({ name: teams.name }).from(teams).where(sql`${teams.autoFormedTournamentId} is not null`);
  const creditRows = await db.execute<{ reason: string; status: string; n: number }>(sql`select reason, status, count(*)::int as n from entry_credits group by 1, 2 order by 1, 2`);
  const templateRows = await db.select({ title: tournamentTemplates.title, active: tournamentTemplates.active, next: tournamentTemplates.nextEdition }).from(tournamentTemplates).orderBy(asc(tournamentTemplates.createdAt));
  const inbox = await db.execute<{ n: number; unread: number }>(sql`select count(*)::int as n, count(*) filter (where read_at is null)::int as unread from notifications`);
  const matchRows = await db.execute<{ status: string; n: number }>(sql`
    select m.status, count(*)::int as n from matches m join tournaments t on t.id = m.tournament_id where t.status = 'live' group by 1 order by 1`);

  console.log("\nCups:");
  for (const c of cups) console.log(`  /torneos/${c.slug.padEnd(22)} ${c.status.padEnd(20)} ${byCup.get(c.slug)?.join(", ") ?? ""}`);
  console.log(`\nAuto-formed teams: ${autoTeams.map((t) => t.name).join(", ") || "none"}`);
  console.log(`Credits: ${[...creditRows].map((r) => `${r.n} ${r.reason}/${r.status}`).join(", ")}`);
  console.log(`Live bracket matches: ${[...matchRows].map((r) => `${r.n} ${r.status}`).join(", ")}`);
  console.log(`Templates: ${templateRows.map((r) => `${r.title} (${r.active ? "active" : "paused"}, next #${r.next})`).join(", ")}`);
  console.log(`Notifications: ${inbox[0]!.n} (${inbox[0]!.unread} unread), none emailed`);
  console.log(`\nEvery seed user signs in with password "${PASSWORD}" at <handle>@${EMAIL_DOMAIN}:
  admin       admin, every /admin page, /admin/plantillas with an active, a paused and a not-yet-run template
  mod         moderator, /mod console with a Riot-scored report on a tournament code, a dispute and a delayed match
  tomi        NDU captain, fully checked in to Copa Nocturna
  chino       ASD captain, short-handed in Copa Nocturna (3 of 5), has to decide; holds a Primavera credit
  dario       RCH captain, short-handed and chose to play; 3/5 paid in Copa Semanal #4
  fer         CBA captain, not checked in (forfeits when check-in closes); waitlisted in Copa Diamante
  ale         GDN captain, open team (4/5) in Copa Semanal #4 with a pool request and a recruit pending
  kiara       pool player who asked to join GDN; bruno: pool player GDN recruited
  agus        current Plat I, season peak Emerald II (profile and rank source); email notifications off
  kevo        Master player playing under eligibility exceptions
  ivo         rank override to Diamond II; captain of Los Inmortales (pending join request in /notificaciones)
  tadeo       invited to Los Inmortales, invite waiting in /notificaciones
  uli         fails account minimums (level 21, 9 ranked games)
  marti       no Riot ID linked`);
}

await main();
process.exit(0);
