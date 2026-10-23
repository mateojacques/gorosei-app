import { eq } from "drizzle-orm";
import { NO_EMAIL_DOMAIN } from "../../shared/notifications";
import { formatRiotId } from "../../shared/riot-id";
import { writeAudit } from "../audit";
import { type Db, type Executor, uniqueViolation } from "../db/client";
import { riotAccounts, user } from "../db/schema";
import type { RiotClient } from "../riot/types";
import { recordRankSnapshot } from "./ranks";

export const RSO_PROVIDER_ID = "riot";

type Deps = { db: Db; riot: RiotClient };

/**
 * The Better Auth profile for a Riot Sign On token. A Riot account already linked (by icon change) answers
 * with that user's email, so Better Auth signs them in to their existing account; a new one gets a
 * placeholder address on a domain that is never emailed. Null when Riot fails, which fails the sign-in.
 */
export async function rsoUserInfo(
  deps: Deps,
  accessToken: string,
): Promise<{ id: string; name: string; email: string; emailVerified: boolean } | null> {
  const account = await deps.riot.getAccountByAccessToken(accessToken);
  if (!account.ok) return null;
  const { puuid } = account.data;
  const [linked] = await deps.db
    .select({ email: user.email })
    .from(riotAccounts)
    .innerJoin(user, eq(user.id, riotAccounts.userId))
    .where(eq(riotAccounts.puuid, puuid));
  return {
    id: puuid,
    name: formatRiotId(account.data),
    email: linked?.email ?? `${puuid}@${NO_EMAIL_DOMAIN}`,
    emailVerified: !!linked,
  };
}

/** One Riot account per platform account and vice versa. */
export async function rsoLinkAllowed(db: Executor, userId: string, puuid: string): Promise<boolean> {
  const [byPuuid] = await db.select({ userId: riotAccounts.userId }).from(riotAccounts).where(eq(riotAccounts.puuid, puuid));
  if (byPuuid) return byPuuid.userId === userId;
  const [byUser] = await db.select({ id: riotAccounts.id }).from(riotAccounts).where(eq(riotAccounts.userId, userId));
  return !byUser;
}

/** Stores the Riot account behind an RSO sign-in, read with the API key. Idempotent for the same user and account. */
export async function linkRsoAccount(
  deps: Deps,
  userId: string,
  puuid: string,
): Promise<{ ok: true; riotAccountId: string } | { ok: false; reason: "taken_by_other" | "riot_unavailable" }> {
  const { db, riot } = deps;
  const existing = async () => {
    const [row] = await db.select({ id: riotAccounts.id, userId: riotAccounts.userId }).from(riotAccounts).where(eq(riotAccounts.puuid, puuid));
    return row;
  };
  const before = await existing();
  if (before) return before.userId === userId ? { ok: true, riotAccountId: before.id } : { ok: false, reason: "taken_by_other" };

  const account = await riot.getAccountByPuuid(puuid);
  if (!account.ok) return { ok: false, reason: "riot_unavailable" };
  const summoner = await riot.getSummonerByPuuid(puuid);
  if (!summoner.ok) return { ok: false, reason: "riot_unavailable" };

  let riotAccountId: string;
  try {
    riotAccountId = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(riotAccounts)
        .values({
          userId,
          puuid,
          gameName: account.data.gameName,
          tagLine: account.data.tagLine,
          summonerLevel: summoner.data.summonerLevel,
          profileIconId: summoner.data.profileIconId,
        })
        .returning({ id: riotAccounts.id });
      await writeAudit(tx, {
        actorUserId: userId,
        action: "riot_account.linked",
        entityType: "riot_account",
        entityId: inserted!.id,
        data: { puuid, gameName: account.data.gameName, tagLine: account.data.tagLine, via: "rso" },
      });
      return inserted!.id;
    });
  } catch (error) {
    if (uniqueViolation(error) === null) throw error;
    const raced = await existing();
    return raced?.userId === userId ? { ok: true, riotAccountId: raced.id } : { ok: false, reason: "taken_by_other" };
  }
  // The link stands even if Riot fails here; the next poll records the first snapshot.
  await recordRankSnapshot({ db, riot }, riotAccountId);
  return { ok: true, riotAccountId };
}
