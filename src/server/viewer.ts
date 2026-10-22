import { eq } from "drizzle-orm";
import type { SessionUser } from "./auth";
import type { Db } from "./db/client";
import { riotAccounts } from "./db/schema";
import { countUnread } from "./notifications/inbox";
import type { ViewerState } from "./viewer.functions";

// The shell and the landing page must render even when auth or the database is down.
export async function viewerStateOrSignedOut(load: () => Promise<ViewerState>): Promise<ViewerState> {
  try {
    return await load();
  } catch (error) {
    console.error("viewer state lookup failed", error);
    return { signedIn: false };
  }
}

export async function viewerStateFor(db: Db, user: SessionUser): Promise<ViewerState> {
  const [[riotAccount], unreadNotifications] = await Promise.all([
    db
      .select({ gameName: riotAccounts.gameName, tagLine: riotAccounts.tagLine })
      .from(riotAccounts)
      .where(eq(riotAccounts.userId, user.id)),
    countUnread(db, user.id),
  ]);
  return { signedIn: true, userId: user.id, role: user.role, riotAccount: riotAccount ?? null, unreadNotifications };
}
