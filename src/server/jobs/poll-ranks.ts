import { asc, sql } from "drizzle-orm";
import { riotAccounts } from "../db/schema";
import { type RankDeps, recordRankSnapshot } from "../identity/ranks";

export async function pollAllRanks(deps: RankDeps): Promise<{ polled: number; failed: number }> {
  const accounts = await deps.db
    .select({ id: riotAccounts.id })
    .from(riotAccounts)
    .orderBy(sql`${riotAccounts.lastPolledAt} asc nulls first`, asc(riotAccounts.linkedAt));

  let polled = 0;
  let failed = 0;
  for (const account of accounts) {
    // Sequential on purpose: keeps us well inside Riot's per-second rate limit.
    if ((await recordRankSnapshot(deps, account.id)) === "recorded") polled++;
    else failed++;
  }
  return { polled, failed };
}
