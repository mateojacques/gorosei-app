import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { NotificationKind, NotificationPayload } from "../../../shared/notifications";
import { user } from "./auth";

const tz = (name: string) => timestamp(name, { withTimezone: true });

export type EmailStatus = "pending" | "sending" | "sent" | "failed" | "skipped";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id),
    kind: text("kind").$type<NotificationKind>().notNull(),
    payload: jsonb("payload").$type<NotificationPayload>().notNull(),
    href: text("href").notNull(),
    // `<key>:<userId>`; a repeated action or job run inserts nothing.
    dedupeKey: text("dedupe_key").unique(),
    createdAt: tz("created_at").notNull().defaultNow(),
    readAt: tz("read_at"),
    emailStatus: text("email_status").$type<EmailStatus>().notNull().default("pending"),
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailedAt: tz("emailed_at"),
  },
  (t) => [
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
    index("notifications_email_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.emailStatus} = 'pending'`),
  ],
);
