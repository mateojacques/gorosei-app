import { and, eq, inArray } from "drizzle-orm";
import { type UserRole, isModerator } from "../../shared/match";
import type { Executor } from "../db/client";
import { matches, registrationPlayers } from "../db/schema";

/** Active roster players of either team (starters and subs), moderators and admins. */
export async function canAccessMatchChat(db: Executor, user: { id: string; role: UserRole }, matchId: string): Promise<boolean> {
  const [match] = await db.select({ reg1Id: matches.reg1Id, reg2Id: matches.reg2Id }).from(matches).where(eq(matches.id, matchId));
  if (!match) return false;
  if (isModerator(user.role)) return true;
  const ids = [match.reg1Id, match.reg2Id].filter((id): id is string => id !== null);
  if (ids.length === 0) return false;
  const [row] = await db
    .select({ userId: registrationPlayers.userId })
    .from(registrationPlayers)
    .where(
      and(inArray(registrationPlayers.registrationId, ids), eq(registrationPlayers.userId, user.id), eq(registrationPlayers.active, true)),
    );
  return !!row;
}
