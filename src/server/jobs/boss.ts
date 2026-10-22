import { PgBoss } from "pg-boss";
import { db } from "../db/client";
import { env } from "../env";
import { riot } from "../riot";
import { advanceTournaments } from "./advance-tournaments";
import { closeDueRegistrations } from "./close-registrations";
import { createDueEditions } from "./create-editions";
import { pollAllRanks } from "./poll-ranks";

const POLL_RANKS = "poll-ranks";
const EVERY_SIX_HOURS = "0 */6 * * *";
const CLOSE_REGISTRATIONS = "close-registrations";
const ADVANCE_TOURNAMENTS = "advance-tournaments";
const CREATE_EDITIONS = "create-editions";
const EVERY_MINUTE = "* * * * *";

export async function registerJobs(boss: PgBoss): Promise<void> {
  await boss.createQueue(POLL_RANKS);
  await boss.schedule(POLL_RANKS, EVERY_SIX_HOURS);
  await boss.work(POLL_RANKS, async () => {
    const result = await pollAllRanks({ db, riot });
    console.info(`[jobs] ${POLL_RANKS}: polled ${result.polled}, failed ${result.failed}`);
  });
  await boss.createQueue(CLOSE_REGISTRATIONS);
  await boss.schedule(CLOSE_REGISTRATIONS, EVERY_MINUTE);
  await boss.work(CLOSE_REGISTRATIONS, async () => {
    const result = await closeDueRegistrations(db, new Date());
    console.info(`[jobs] ${CLOSE_REGISTRATIONS}: closed ${result.closed}`);
  });
  await boss.createQueue(ADVANCE_TOURNAMENTS);
  await boss.schedule(ADVANCE_TOURNAMENTS, EVERY_MINUTE);
  await boss.work(ADVANCE_TOURNAMENTS, async () => {
    const result = await advanceTournaments(db, new Date());
    console.info(`[jobs] ${ADVANCE_TOURNAMENTS}: opened ${result.opened}, closed ${result.closed}`);
  });
  await boss.createQueue(CREATE_EDITIONS);
  await boss.schedule(CREATE_EDITIONS, EVERY_MINUTE);
  await boss.work(CREATE_EDITIONS, async () => {
    const result = await createDueEditions(db, new Date());
    console.info(`[jobs] ${CREATE_EDITIONS}: created ${result.created}`);
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
