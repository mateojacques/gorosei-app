import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { BracketData } from "../../bracket/engine";
import type { MatchPhase, MatchStatus } from "../../../shared/match";
import { user } from "./auth";
import { registrations, tournaments } from "./competition";

const tz = (name: string) => timestamp(name, { withTimezone: true });

export const checkIns = pgTable(
  "check_ins",
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
    checkedInAt: tz("checked_in_at").notNull().defaultNow(),
    // Set when a moderator checked the player in (a swap).
    byUserId: text("by_user_id").references(() => user.id),
  },
  (t) => [primaryKey({ columns: [t.registrationId, t.userId] })],
);

export const brackets = pgTable("brackets", {
  tournamentId: uuid("tournament_id")
    .primaryKey()
    .references(() => tournaments.id),
  data: jsonb("data").$type<BracketData>().notNull(),
  stageId: integer("stage_id").notNull(),
  finalStandings: jsonb("final_standings").$type<{ registrationId: string; rank: number }[]>(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export const matches = pgTable(
  "matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tournaments.id),
    bmMatchId: integer("bm_match_id").notNull(),
    phase: text("phase").$type<MatchPhase>().notNull(),
    groupNo: integer("group_no").notNull(),
    roundNo: integer("round_no").notNull(),
    number: integer("number").notNull(),
    bestOf: integer("best_of").$type<1 | 3 | 5>().notNull(),
    reg1Id: uuid("reg1_id").references(() => registrations.id),
    reg2Id: uuid("reg2_id").references(() => registrations.id),
    status: text("status").$type<MatchStatus>().notNull().default("waiting"),
    lobbyName: text("lobby_name"),
    lobbyPassword: text("lobby_password"),
    lobbyPostedBy: text("lobby_posted_by").references(() => user.id),
    // A Riot tournament code, used for every game of the match; private like the lobby.
    tournamentCode: text("tournament_code"),
    openedAt: tz("opened_at"),
    score1: integer("score1"),
    score2: integer("score2"),
    winnerRegId: uuid("winner_reg_id").references(() => registrations.id),
    confirmedBy: text("confirmed_by").references(() => user.id),
    confirmedAt: tz("confirmed_at"),
    riotMatchIds: jsonb("riot_match_ids").$type<string[]>().notNull().default([]),
    stats: jsonb("stats").$type<unknown>(),
    // Games won per side according to Riot match data (result callbacks); a moderator still confirms.
    riotScore: jsonb("riot_score").$type<{ score1: number; score2: number }>(),
    // A moderator-set https link to the recorded broadcast of this match.
    vodUrl: text("vod_url"),
  },
  (t) => [uniqueIndex("matches_tournament_bm_idx").on(t.tournamentId, t.bmMatchId), index("matches_status_idx").on(t.status)],
);

export const matchReports = pgTable(
  "match_reports",
  {
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id),
    score1: integer("score1").notNull(),
    score2: integer("score2").notNull(),
    screenshotUrl: text("screenshot_url"),
    riotMatchIds: jsonb("riot_match_ids").$type<string[]>().notNull().default([]),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.registrationId] })],
);

export const matchMessages = pgTable(
  "match_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matches.id),
    authorUserId: text("author_user_id").references(() => user.id),
    kind: text("kind").$type<"message" | "system" | "lobby">().notNull(),
    body: text("body").notNull(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [index("match_messages_match_idx").on(t.matchId, t.createdAt)],
);
