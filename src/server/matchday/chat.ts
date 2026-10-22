import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { type UserRole, isModerator } from "../../shared/match";
import { formatRiotId } from "../../shared/riot-id";
import type { Db, Executor } from "../db/client";
import { matchMessages, matches, registrationPlayers, riotAccounts } from "../db/schema";
import { publish } from "../realtime/hub";

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

export type ChatMessage = {
  id: string;
  kind: "message" | "system" | "lobby";
  authorUserId: string | null;
  authorRiotId: string | null;
  body: string;
  createdAt: Date;
};

const MAX_BODY_LENGTH = 1000;
const CHAT_OPEN_AFTER_COMPLETED_MS = 24 * 60 * 60_000;
const DEFAULT_LIMIT = 100;

const toMessage = (
  row: typeof matchMessages.$inferSelect,
  riotIds: Map<string, string>,
): ChatMessage => ({
  id: row.id,
  kind: row.kind,
  authorUserId: row.authorUserId,
  authorRiotId: row.authorUserId ? (riotIds.get(row.authorUserId) ?? null) : null,
  body: row.body,
  createdAt: row.createdAt,
});

async function riotIdsOf(db: Executor, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await db.select().from(riotAccounts).where(inArray(riotAccounts.userId, userIds));
  return new Map(rows.map((r) => [r.userId, formatRiotId(r)]));
}

export async function postMessage(
  db: Db,
  user: { id: string; role: UserRole },
  matchId: string,
  body: string,
  now: Date = new Date(),
): Promise<
  { ok: true; message: ChatMessage } | { ok: false; reason: "not_found" | "forbidden" | "empty" | "too_long" | "closed" }
> {
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return { ok: false, reason: "not_found" };
  if (!(await canAccessMatchChat(db, user, matchId))) return { ok: false, reason: "forbidden" };
  const text = body.trim();
  if (text.length === 0) return { ok: false, reason: "empty" };
  if ([...text].length > MAX_BODY_LENGTH) return { ok: false, reason: "too_long" };
  if (
    !isModerator(user.role) &&
    match.status === "completed" &&
    match.confirmedAt &&
    now.getTime() - match.confirmedAt.getTime() > CHAT_OPEN_AFTER_COMPLETED_MS
  ) {
    return { ok: false, reason: "closed" };
  }
  const [row] = await db
    .insert(matchMessages)
    .values({ matchId, authorUserId: user.id, kind: "message", body: text, createdAt: now })
    .returning();
  const message = toMessage(row!, await riotIdsOf(db, [user.id]));
  publish({ channel: `chat:${matchId}`, type: "message", data: message });
  return { ok: true, message };
}

export async function listMessages(
  db: Db,
  user: { id: string; role: UserRole },
  matchId: string,
  opts: { before?: Date; limit?: number } = {},
): Promise<ChatMessage[] | null> {
  if (!(await canAccessMatchChat(db, user, matchId))) return null;
  const rows = await db
    .select()
    .from(matchMessages)
    .where(and(eq(matchMessages.matchId, matchId), opts.before ? lt(matchMessages.createdAt, opts.before) : undefined))
    .orderBy(desc(matchMessages.createdAt))
    .limit(opts.limit ?? DEFAULT_LIMIT);
  const riotIds = await riotIdsOf(db, [...new Set(rows.flatMap((r) => (r.authorUserId ? [r.authorUserId] : [])))]);
  return rows.reverse().map((r) => toMessage(r, riotIds));
}
