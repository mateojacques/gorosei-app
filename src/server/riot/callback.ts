import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { matches } from "../db/schema";

/** Riot's game-result callback; only the code and game matter, the rest is ignored. */
export const riotCallbackSchema = z.looseObject({
  shortCode: z.string().min(1).max(100),
  gameId: z.number().int().positive(),
});

export type RiotGameJob = { matchId: string; riotMatchId: string };

/** The pg-boss queue that turns a callback into match data. */
export const RIOT_GAME_RESULT = "riot-game-result";

/**
 * A callback is only a hint: it queues a job that reads the game from match-v5 and checks it against the rosters.
 * Unknown codes and finished matches are ignored.
 */
export async function handleRiotCallback(
  deps: { db: Db; enqueue(job: RiotGameJob): Promise<void> },
  body: unknown,
): Promise<"queued" | "ignored" | "invalid"> {
  const parsed = riotCallbackSchema.safeParse(body);
  if (!parsed.success) return "invalid";
  const [match] = await deps.db
    .select({ id: matches.id, status: matches.status })
    .from(matches)
    .where(eq(matches.tournamentCode, parsed.data.shortCode));
  if (!match || match.status === "completed") return "ignored";
  await deps.enqueue({ matchId: match.id, riotMatchId: `LA2_${parsed.data.gameId}` });
  return "queued";
}
