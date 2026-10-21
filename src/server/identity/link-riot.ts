import { eq } from "drizzle-orm";
import { parseRiotId } from "../../shared/riot-id";
import { writeAudit } from "../audit";
import type { Db } from "../db/client";
import { riotAccounts, riotLinkChallenges } from "../db/schema";
import type { RiotClient } from "../riot/types";

const CHALLENGE_DURATION_MS = 30 * 60_000;
// Profile icons 0..28 are the free defaults every account owns.
const FREE_ICON_COUNT = 29;
const UNIQUE_VIOLATION = "23505";

export type LinkRiotDeps = { db: Db; riot: RiotClient; now?: () => Date; random?: () => number };

export type StartResult =
  | { ok: true; requiredIconId: number; expiresAt: Date }
  | { ok: false; reason: "invalid_riot_id" | "riot_not_found" | "already_linked_self" | "taken_by_other" | "riot_unavailable" };

export type ConfirmResult =
  | { ok: true; riotAccountId: string }
  | { ok: false; reason: "no_challenge" | "expired" | "icon_mismatch" | "taken_by_other" | "riot_unavailable" };

export async function startRiotLink(deps: LinkRiotDeps, userId: string, riotIdInput: string): Promise<StartResult> {
  const { db, riot } = deps;
  const now = deps.now?.() ?? new Date();

  const riotId = parseRiotId(riotIdInput);
  if (!riotId) return { ok: false, reason: "invalid_riot_id" };

  if (await findAccount(db, eq(riotAccounts.userId, userId))) return { ok: false, reason: "already_linked_self" };

  const account = await riot.getAccountByRiotId(riotId.gameName, riotId.tagLine);
  if (!account.ok) return { ok: false, reason: account.error === "not_found" ? "riot_not_found" : "riot_unavailable" };
  const { puuid, gameName, tagLine } = account.data;

  if (await findAccount(db, eq(riotAccounts.puuid, puuid))) return { ok: false, reason: "taken_by_other" };

  const summoner = await riot.getSummonerByPuuid(puuid);
  if (!summoner.ok) return { ok: false, reason: summoner.error === "not_found" ? "riot_not_found" : "riot_unavailable" };

  const requiredIconId = pickIcon(summoner.data.profileIconId, deps.random ?? Math.random);
  const expiresAt = new Date(now.getTime() + CHALLENGE_DURATION_MS);
  const challenge = { puuid, gameName, tagLine, requiredIconId, expiresAt, createdAt: now };
  await db
    .insert(riotLinkChallenges)
    .values({ userId, ...challenge })
    .onConflictDoUpdate({ target: riotLinkChallenges.userId, set: challenge });

  return { ok: true, requiredIconId, expiresAt };
}

export async function confirmRiotLink(deps: LinkRiotDeps, userId: string): Promise<ConfirmResult> {
  const { db, riot } = deps;
  const now = deps.now?.() ?? new Date();

  const [challenge] = await db.select().from(riotLinkChallenges).where(eq(riotLinkChallenges.userId, userId));
  if (!challenge) return { ok: false, reason: "no_challenge" };
  if (now > challenge.expiresAt) return { ok: false, reason: "expired" };

  const summoner = await riot.getSummonerByPuuid(challenge.puuid);
  if (!summoner.ok) return { ok: false, reason: "riot_unavailable" };
  if (summoner.data.profileIconId !== challenge.requiredIconId) return { ok: false, reason: "icon_mismatch" };

  try {
    const riotAccountId = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(riotAccounts)
        .values({
          userId,
          puuid: challenge.puuid,
          gameName: challenge.gameName,
          tagLine: challenge.tagLine,
          summonerLevel: summoner.data.summonerLevel,
          profileIconId: summoner.data.profileIconId,
          linkedAt: now,
        })
        .returning({ id: riotAccounts.id });
      const id = inserted!.id;
      await tx.delete(riotLinkChallenges).where(eq(riotLinkChallenges.userId, userId));
      await writeAudit(tx, {
        actorUserId: userId,
        action: "riot_account.linked",
        entityType: "riot_account",
        entityId: id,
        data: { puuid: challenge.puuid, gameName: challenge.gameName, tagLine: challenge.tagLine },
      });
      return id;
    });
    return { ok: true, riotAccountId };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: "taken_by_other" };
    throw error;
  }
}

function pickIcon(currentIconId: number, random: () => number): number {
  const currentIsFree = currentIconId >= 0 && currentIconId < FREE_ICON_COUNT;
  const candidates = currentIsFree ? FREE_ICON_COUNT - 1 : FREE_ICON_COUNT;
  const index = Math.floor(random() * candidates);
  return currentIsFree && index >= currentIconId ? index + 1 : index;
}

async function findAccount(db: Db, where: ReturnType<typeof eq>) {
  const [row] = await db.select({ id: riotAccounts.id }).from(riotAccounts).where(where);
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return cause?.code === UNIQUE_VIOLATION;
}
