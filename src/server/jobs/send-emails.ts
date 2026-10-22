import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { EMAIL_TTL_MS, NO_EMAIL_DOMAIN, type NotificationPayload } from "../../shared/notifications";
import type { Db } from "../db/client";
import { notifications, user } from "../db/schema";
import type { Mailer } from "../email/mailer";
import { renderNotificationEmail } from "../email/render";
import { getEmailEnabled } from "../notifications/settings";

export const MAX_EMAIL_ATTEMPTS = 3;
const STUCK_AFTER_MS = 10 * 60_000;

type Claimed = { id: string; userId: string; payload: NotificationPayload; createdAt: Date; attempts: number };

/**
 * The email outbox. Rows are claimed with one statement (SKIP LOCKED), so concurrent runs never share a row;
 * mail goes out outside any transaction and each outcome is written back.
 */
export async function sendPendingEmails(
  deps: { db: Db; mailer: Mailer; origin: string },
  now: Date,
  batch = 50,
): Promise<{ sent: number; skipped: number; failed: number }> {
  const { db, mailer, origin } = deps;
  await recoverStuck(db, now);
  const claimed = await claim(db, now, batch);
  if (claimed.length === 0) return { sent: 0, skipped: 0, failed: 0 };

  const users = await db
    .select({ id: user.id, email: user.email })
    .from(user)
    .where(
      inArray(
        user.id,
        claimed.map((c) => c.userId),
      ),
    );
  const emailOf = new Map(users.map((u) => [u.id, u.email]));
  const counts = { sent: 0, skipped: 0, failed: 0 };

  for (const row of claimed) {
    const email = emailOf.get(row.userId);
    const stale = now.getTime() - row.createdAt.getTime() > EMAIL_TTL_MS[row.payload.kind];
    if (!email || email.endsWith(`@${NO_EMAIL_DOMAIN}`) || stale || !(await getEmailEnabled(db, row.userId))) {
      await finish(db, row.id, "skipped");
      counts.skipped++;
      continue;
    }
    const result = await mailer.send({ to: email, ...renderNotificationEmail(row.payload, origin) }).catch(() => ({
      ok: false as const,
      retryable: true,
    }));
    if (result.ok) {
      await finish(db, row.id, "sent", now);
      counts.sent++;
    } else if (result.retryable && row.attempts < MAX_EMAIL_ATTEMPTS) {
      await finish(db, row.id, "pending");
    } else {
      await finish(db, row.id, "failed");
      counts.failed++;
    }
  }
  return counts;
}

/** A row left "sending" this long was claimed by a run that crashed; it gets its remaining attempts. */
async function recoverStuck(db: Db, now: Date) {
  await db
    .update(notifications)
    .set({ emailStatus: sql`case when ${notifications.emailAttempts} >= ${MAX_EMAIL_ATTEMPTS} then 'failed' else 'pending' end` })
    .where(
      and(eq(notifications.emailStatus, "sending"), lt(notifications.emailClaimedAt, new Date(now.getTime() - STUCK_AFTER_MS))),
    );
}

async function claim(db: Db, now: Date, batch: number): Promise<Claimed[]> {
  const rows = await db.execute<{ id: string; user_id: string; payload: NotificationPayload; created_at: string; email_attempts: number }>(sql`
    update notifications
    set email_status = 'sending', email_attempts = email_attempts + 1, email_claimed_at = ${now.toISOString()}
    where id in (
      select id from notifications
      where email_status = 'pending' and email_attempts < ${MAX_EMAIL_ATTEMPTS}
      order by created_at
      limit ${batch}
      for update skip locked
    )
    returning id, user_id, payload, created_at, email_attempts`);
  return [...rows].map((r) => ({
    id: r.id,
    userId: r.user_id,
    payload: r.payload,
    createdAt: new Date(r.created_at),
    attempts: r.email_attempts,
  }));
}

async function finish(db: Db, id: string, status: "sent" | "pending" | "failed" | "skipped", sentAt?: Date) {
  await db
    .update(notifications)
    .set({ emailStatus: status, ...(sentAt ? { emailedAt: sentAt } : {}) })
    .where(eq(notifications.id, id));
}
