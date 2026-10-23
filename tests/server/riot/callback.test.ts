import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { matches } from "../../../src/server/db/schema";
import { handleRiotCallback } from "../../../src/server/riot/callback";
import { startedTestTournament } from "../../helpers/competition";
import { resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

function recorder() {
  const jobs: { matchId: string; riotMatchId: string }[] = [];
  return { jobs, deps: { db: testDb, enqueue: async (job: { matchId: string; riotMatchId: string }) => void jobs.push(job) } };
}

const body = (shortCode: string, gameId: number) => ({
  startTime: 1_700_000_000_000,
  shortCode,
  metaData: "match-id",
  gameId,
  gameName: "x",
  gameType: "CUSTOM_GAME",
  gameMap: 11,
  gameMode: "CLASSIC",
  region: "LA2",
});

test("a callback for a known code queues its game", async () => {
  await startedTestTournament(2);
  const [match] = await testDb.select().from(matches);
  await testDb.update(matches).set({ tournamentCode: "LA2-CODE", status: "in_progress" }).where(eq(matches.id, match!.id));
  const { jobs, deps } = recorder();
  expect(await handleRiotCallback(deps, body("LA2-CODE", 123456))).toBe("queued");
  expect(jobs).toEqual([{ matchId: match!.id, riotMatchId: "LA2_123456" }]);
});

test("unknown codes and completed matches are ignored", async () => {
  await startedTestTournament(2);
  const [match] = await testDb.select().from(matches);
  const { jobs, deps } = recorder();
  expect(await handleRiotCallback(deps, body("NOPE", 1))).toBe("ignored");
  await testDb.update(matches).set({ tournamentCode: "LA2-CODE", status: "completed" }).where(eq(matches.id, match!.id));
  expect(await handleRiotCallback(deps, body("LA2-CODE", 1))).toBe("ignored");
  expect(jobs).toEqual([]);
});

test("a body without a code or game is invalid", async () => {
  const { deps } = recorder();
  expect(await handleRiotCallback(deps, { hello: "world" })).toBe("invalid");
  expect(await handleRiotCallback(deps, "junk")).toBe("invalid");
});
