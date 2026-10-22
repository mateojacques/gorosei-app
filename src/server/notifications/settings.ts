import { eq } from "drizzle-orm";
import type { Db, Executor } from "../db/client";
import { notificationSettings } from "../db/schema";

export async function getEmailEnabled(db: Executor, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ emailEnabled: notificationSettings.emailEnabled })
    .from(notificationSettings)
    .where(eq(notificationSettings.userId, userId));
  return row?.emailEnabled ?? true;
}

export async function setEmailEnabled(db: Db, userId: string, enabled: boolean): Promise<void> {
  await db
    .insert(notificationSettings)
    .values({ userId, emailEnabled: enabled })
    .onConflictDoUpdate({ target: notificationSettings.userId, set: { emailEnabled: enabled } });
}
