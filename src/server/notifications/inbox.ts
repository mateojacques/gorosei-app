import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import type { NotificationPayload } from "../../shared/notifications";
import type { Db } from "../db/client";
import { notifications } from "../db/schema";

export type NotificationView = { id: string; payload: NotificationPayload; href: string; createdAt: Date; read: boolean };

export async function listNotifications(db: Db, userId: string, limit = 50): Promise<NotificationView[]> {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, payload: r.payload, href: r.href, createdAt: r.createdAt, read: r.readAt !== null }));
}

export async function countUnread(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Marks read the rows created at or before `upTo`, which comes from a list the user saw (millisecond precision). */
export async function markAllRead(db: Db, userId: string, upTo: Date): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        sql`date_trunc('milliseconds', ${notifications.createdAt}) <= ${upTo.toISOString()}`,
      ),
    );
}
