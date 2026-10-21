import { PgBoss } from "pg-boss";
import { db } from "../db/client";
import { env } from "../env";
import { riot } from "../riot";
import { pollAllRanks } from "./poll-ranks";

const POLL_RANKS = "poll-ranks";
const EVERY_SIX_HOURS = "0 */6 * * *";

export async function registerJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue(POLL_RANKS);
  await boss.schedule(POLL_RANKS, EVERY_SIX_HOURS);
  await boss.work(POLL_RANKS, async () => {
    const result = await pollAllRanks({ db, riot });
    console.info(`[jobs] ${POLL_RANKS}: polled ${result.polled}, failed ${result.failed}`);
  });
}

let started: Promise<PgBoss> | undefined;

/** Starts pg-boss once per server process. Never runs under `bun test`. */
export function startJobs(): Promise<PgBoss> | undefined {
  if (process.env.NODE_ENV === "test") return undefined;
  started ??= (async () => {
    const boss = new PgBoss(env.DATABASE_URL);
    boss.on("error", (error) => console.error("[jobs] pg-boss error", error));
    await boss.start();
    await registerJobs(boss);
    return boss;
  })();
  return started;
}
