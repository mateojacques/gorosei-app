import { type APIRequestContext, request } from "@playwright/test";
import { eq } from "drizzle-orm";
import type { Role } from "../../src/server/auth";
import { rankSnapshots, riotAccounts, user } from "../../src/server/db/schema";
import type { Rank } from "../../src/shared/rank";
import { testDb } from "../../tests/helpers/db";

const BASE_URL = "http://localhost:3100";

export type StorageState = Awaited<ReturnType<APIRequestContext["storageState"]>>;

/**
 * Signs a player up through the real auth endpoint and returns their session as a storage state.
 * The Riot account and rank snapshot go straight into the test database: e2e never calls Riot.
 */
export async function createPlayer(opts: {
  name: string;
  email: string;
  riot?: { gameName: string; tagLine: string; rank?: Rank | null; level?: number };
  role?: Role;
}): Promise<{ userId: string; storageState: StorageState }> {
  const context = await request.newContext({ baseURL: BASE_URL });
  try {
    const res = await context.post("/api/auth/sign-up/email", {
      headers: { origin: BASE_URL },
      data: { name: opts.name, email: opts.email, password: "contraseña-segura" },
    });
    if (!res.ok()) throw new Error(`createPlayer: sign-up failed with ${res.status()}`);
    const userId: string = (await res.json()).user.id;

    if (opts.role) await testDb.update(user).set({ role: opts.role }).where(eq(user.id, userId));
    if (opts.riot) {
      const { gameName, tagLine, rank = null, level = 30 } = opts.riot;
      const [account] = await testDb
        .insert(riotAccounts)
        .values({ userId, puuid: `e2e-puuid-${userId}`, gameName, tagLine, summonerLevel: level, profileIconId: 0 })
        .returning({ id: riotAccounts.id });
      await testDb.insert(rankSnapshots).values({
        riotAccountId: account!.id,
        tier: rank?.tier ?? null,
        division: rank?.division ?? null,
        lp: rank?.lp ?? null,
        wins: 0,
        losses: 0,
        observedAt: new Date(),
      });
    }
    return { userId, storageState: await context.storageState() };
  } finally {
    await context.dispose();
  }
}
