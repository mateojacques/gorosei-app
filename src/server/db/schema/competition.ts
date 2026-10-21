import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { EligibilityRule, PlayerSnapshot } from "../../../shared/eligibility";
import type { RANK_SOURCES, RegistrationStatus, TournamentStatus } from "../../../shared/tournament";
import { user } from "./auth";
import { riotAccounts } from "./identity";

const tz = (name: string) => timestamp(name, { withTimezone: true });

export const tournaments = pgTable("tournaments", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  edition: integer("edition").notNull(),
  status: text("status").$type<TournamentStatus>().notNull().default("draft"),
  startsAt: tz("starts_at").notNull(),
  registrationClosesAt: tz("registration_closes_at").notNull(),
  bracket: text("bracket").$type<"double_elimination" | "single_elimination">().notNull(),
  draftMode: text("draft_mode").$type<"tournament_draft" | "blind_pick">().notNull(),
  bestOf: integer("best_of").$type<1 | 3 | 5>().notNull(),
  finalsBestOf: integer("finals_best_of").$type<1 | 3 | 5>().notNull(),
  teamCap: integer("team_cap").notNull(),
  maxSubs: integer("max_subs").notNull(),
  subsCountForTeamRules: boolean("subs_count_for_team_rules").notNull(),
  rankSource: text("rank_source").$type<(typeof RANK_SOURCES)[number]>().notNull().default("peak_season"),
  eligibilityRules: jsonb("eligibility_rules").$type<EligibilityRule[]>().notNull(),
  entryFeeArs: integer("entry_fee_ars").notNull(),
  prizeGoalArs: integer("prize_goal_ars").notNull(),
  prizeSplit: jsonb("prize_split").$type<number[]>().notNull(),
  paymentInstructions: text("payment_instructions").notNull(),
  rulesText: text("rules_text").notNull(),
  streamUrl: text("stream_url").notNull(),
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    tag: text("tag").notNull().unique(),
    captainUserId: text("captain_user_id")
      .notNull()
      .references(() => user.id),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("teams_name_lower_idx").on(sql`lower(${t.name})`)],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    role: text("role").$type<"captain" | "member">().notNull(),
    joinedAt: tz("joined_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

export const teamRequests = pgTable(
  "team_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind").$type<"invite" | "join_request">().notNull(),
    status: text("status").$type<"pending" | "accepted" | "declined" | "cancelled">().notNull().default("pending"),
    createdAt: tz("created_at").notNull().defaultNow(),
    resolvedAt: tz("resolved_at"),
  },
  (t) => [
    uniqueIndex("team_requests_one_pending_idx")
      .on(t.teamId, t.userId)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    status: text("status").$type<RegistrationStatus>().notNull().default("pending"),
    // When the registration last started qualifying (full, eligible, paid); orders cap slots and the waitlist.
    qualifiedAt: tz("qualified_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // A team has at most one live registration per tournament; it can register again after withdrawing.
    uniqueIndex("registrations_one_active_per_team_idx")
      .on(t.tournamentId, t.teamId)
      .where(sql`${t.status} not in ('withdrawn', 'dropped')`),
  ],
);

export const registrationPlayers = pgTable(
  "registration_players",
  {
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    riotAccountId: uuid("riot_account_id")
      .notNull()
      .references(() => riotAccounts.id),
    isSub: boolean("is_sub").notNull(),
    snapshot: jsonb("snapshot").$type<PlayerSnapshot>().notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.registrationId, t.userId] }),
    // The database guarantees one active roster per player per tournament.
    uniqueIndex("registration_players_one_active_idx")
      .on(t.tournamentId, t.userId)
      .where(sql`${t.active}`),
  ],
);

export const eligibilityExceptions = pgTable(
  "eligibility_exceptions",
  {
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id),
    ruleId: text("rule_id").notNull(),
    reason: text("reason").notNull(),
    grantedBy: text("granted_by")
      .notNull()
      .references(() => user.id),
    grantedAt: tz("granted_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.teamId, t.ruleId] })],
);

export const entryPayments = pgTable(
  "entry_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    // Attached to the tournament, not to a roster: a player keeps their payment when moving between teams.
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    source: text("source").$type<"payment" | "credit">().notNull(),
    reference: text("reference").notNull(),
    creditId: uuid("credit_id"),
    forfeited: boolean("forfeited").notNull().default(false),
    recordedBy: text("recorded_by")
      .notNull()
      .references(() => user.id),
    recordedAt: tz("recorded_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("entry_payments_tournament_user_idx").on(t.tournamentId, t.userId)],
);
