import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";

const tz = (name: string) => timestamp(name, { withTimezone: true });

export const riotAccounts = pgTable("riot_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  puuid: text("puuid").notNull().unique(),
  gameName: text("game_name").notNull(),
  tagLine: text("tag_line").notNull(),
  summonerLevel: integer("summoner_level").notNull(),
  profileIconId: integer("profile_icon_id").notNull(),
  linkedAt: tz("linked_at").notNull().defaultNow(),
  lastPolledAt: tz("last_polled_at"),
});

export const riotLinkChallenges = pgTable("riot_link_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  puuid: text("puuid").notNull(),
  gameName: text("game_name").notNull(),
  tagLine: text("tag_line").notNull(),
  requiredIconId: integer("required_icon_id").notNull(),
  expiresAt: tz("expires_at").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const rankSnapshots = pgTable(
  "rank_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    riotAccountId: uuid("riot_account_id")
      .notNull()
      .references(() => riotAccounts.id),
    // tier = null means unranked in RANKED_SOLO_5x5.
    tier: text("tier"),
    division: text("division"),
    lp: integer("lp"),
    wins: integer("wins").notNull(),
    losses: integer("losses").notNull(),
    observedAt: tz("observed_at").notNull(),
  },
  (t) => [index("rank_snapshots_account_observed_idx").on(t.riotAccountId, t.observedAt)],
);

export const rankOverrides = pgTable("rank_overrides", {
  riotAccountId: uuid("riot_account_id")
    .primaryKey()
    .references(() => riotAccounts.id),
  tier: text("tier").notNull(),
  division: text("division").notNull(),
  reason: text("reason").notNull(),
  setBy: text("set_by")
    .notNull()
    .references(() => user.id),
  setAt: tz("set_at").notNull().defaultNow(),
});
