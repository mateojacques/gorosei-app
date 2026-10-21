import { eq } from "drizzle-orm";
import { writeAudit } from "./audit";
import type { Db } from "./db/client";
import { appSettings } from "./db/schema";

const SEASON_START = "season_start";

export async function getSeasonStart(db: Db): Promise<Date> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, SEASON_START));
  if (typeof row?.value === "string") return new Date(row.value);
  return new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
}

export async function setSeasonStart(db: Db, actorUserId: string, d: Date): Promise<void> {
  await db.transaction(async (tx) => {
    const value = d.toISOString();
    await tx
      .insert(appSettings)
      .values({ key: SEASON_START, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } });
    await writeAudit(tx, {
      actorUserId,
      action: "settings.season_start_set",
      entityType: "app_setting",
      entityId: SEASON_START,
      data: { value },
    });
  });
}
