import { sql } from "drizzle-orm";
import { notificationHref, type NotificationPayload } from "../../shared/notifications";
import type { Executor } from "../db/client";
import { notifications } from "../db/schema";

export const NOTIFICATION_CHANNEL = "notifications";

/**
 * Writes one notification per distinct user, inside the caller's transaction. Postgres delivers the
 * `pg_notify` only on commit, so rolled-back work never pings anyone. Returns the rows inserted.
 */
export async function notify(
  tx: Executor,
  userIds: string[],
  payload: NotificationPayload,
  dedupeKey?: string,
): Promise<number> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return 0;
  const href = notificationHref(payload);
  const inserted = await tx
    .insert(notifications)
    .values(
      unique.map((userId) => ({
        userId,
        kind: payload.kind,
        payload,
        href,
        dedupeKey: dedupeKey === undefined ? null : `${dedupeKey}:${userId}`,
      })),
    )
    .onConflictDoNothing()
    .returning({ userId: notifications.userId });
  for (const row of inserted) await tx.execute(sql`select pg_notify(${NOTIFICATION_CHANNEL}, ${row.userId})`);
  return inserted.length;
}
