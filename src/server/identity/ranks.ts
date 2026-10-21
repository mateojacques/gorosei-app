import { and, desc, eq, gte } from "drizzle-orm";
import { type Rank, isDivision, isTier, maxRank } from "../../shared/rank";
import { writeAudit } from "../audit";
import type { Db } from "../db/client";
import { rankOverrides, rankSnapshots, riotAccounts } from "../db/schema";
import type { RiotClient } from "../riot/types";
import { getSeasonStart } from "../settings";

export type RankSource = "current" | "peak_season";
export type RankDeps = { db: Db; riot: RiotClient; now?: () => Date };

type SnapshotRow = { tier: string | null; division: string | null; lp: number | null };

function toRank(row: SnapshotRow): Rank | null {
  if (!isTier(row.tier) || !isDivision(row.division)) return null;
  return { tier: row.tier, division: row.division, lp: row.lp ?? 0 };
}

const rankColumns = { tier: rankSnapshots.tier, division: rankSnapshots.division, lp: rankSnapshots.lp };

/** Fetches the account's solo rank and Riot profile, stores a snapshot and refreshes the account. */
export async function recordRankSnapshot(deps: RankDeps, riotAccountId: string): Promise<"recorded" | "riot_unavailable"> {
  const { db, riot } = deps;
  const now = deps.now?.() ?? new Date();
  const [account] = await db.select({ puuid: riotAccounts.puuid }).from(riotAccounts).where(eq(riotAccounts.id, riotAccountId));
  if (!account) throw new Error(`Unknown riot account ${riotAccountId}`);

  const [rank, riotId, summoner] = await Promise.all([
    riot.getSoloRankByPuuid(account.puuid),
    riot.getAccountByPuuid(account.puuid),
    riot.getSummonerByPuuid(account.puuid),
  ]);
  if (!rank.ok || !riotId.ok || !summoner.ok) return "riot_unavailable";

  await db.transaction(async (tx) => {
    await tx.insert(rankSnapshots).values({
      riotAccountId,
      tier: rank.data?.tier ?? null,
      division: rank.data?.division ?? null,
      lp: rank.data?.lp ?? null,
      wins: rank.data?.wins ?? 0,
      losses: rank.data?.losses ?? 0,
      observedAt: now,
    });
    await tx
      .update(riotAccounts)
      .set({
        gameName: riotId.data.gameName,
        tagLine: riotId.data.tagLine,
        summonerLevel: summoner.data.summonerLevel,
        profileIconId: summoner.data.profileIconId,
        lastPolledAt: now,
      })
      .where(eq(riotAccounts.id, riotAccountId));
  });
  return "recorded";
}

export async function getCurrentRank(db: Db, riotAccountId: string): Promise<Rank | null> {
  const [latest] = await db
    .select(rankColumns)
    .from(rankSnapshots)
    .where(eq(rankSnapshots.riotAccountId, riotAccountId))
    .orderBy(desc(rankSnapshots.observedAt))
    .limit(1);
  return latest ? toRank(latest) : null;
}

export async function getSeasonPeak(db: Db, riotAccountId: string): Promise<Rank | null> {
  const seasonStart = await getSeasonStart(db);
  const rows = await db
    .select(rankColumns)
    .from(rankSnapshots)
    .where(and(eq(rankSnapshots.riotAccountId, riotAccountId), gte(rankSnapshots.observedAt, seasonStart)));
  return maxRank(rows.map(toRank));
}

export async function getEffectiveRank(db: Db, riotAccountId: string, source: RankSource): Promise<Rank | null> {
  const [override] = await db
    .select({ tier: rankOverrides.tier, division: rankOverrides.division })
    .from(rankOverrides)
    .where(eq(rankOverrides.riotAccountId, riotAccountId));
  if (override) return toRank({ ...override, lp: 0 });
  return source === "current" ? getCurrentRank(db, riotAccountId) : getSeasonPeak(db, riotAccountId);
}

export async function setRankOverride(
  db: Db,
  actorUserId: string,
  riotAccountId: string,
  rank: Pick<Rank, "tier" | "division">,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const values = { tier: rank.tier, division: rank.division, reason, setBy: actorUserId, setAt: new Date() };
    await tx
      .insert(rankOverrides)
      .values({ riotAccountId, ...values })
      .onConflictDoUpdate({ target: rankOverrides.riotAccountId, set: values });
    await writeAudit(tx, {
      actorUserId,
      action: "rank.override_set",
      entityType: "riot_account",
      entityId: riotAccountId,
      data: { tier: rank.tier, division: rank.division, reason },
    });
  });
}

export async function clearRankOverride(db: Db, actorUserId: string, riotAccountId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(rankOverrides).where(eq(rankOverrides.riotAccountId, riotAccountId));
    await writeAudit(tx, {
      actorUserId,
      action: "rank.override_cleared",
      entityType: "riot_account",
      entityId: riotAccountId,
    });
  });
}
