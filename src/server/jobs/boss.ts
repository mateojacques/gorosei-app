import { PgBoss } from "pg-boss";
import { db } from "../db/client";
import { env } from "../env";
import { createLogMailer, createResendMailer } from "../email/mailer";
import { issueTournamentCodes, riotCallbackUrl } from "../matchday/tournament-codes";
import { riot } from "../riot";
import { type RiotFeatures, features } from "../riot/features";
import { createRiotTournamentClient } from "../riot/tournament-client";
import { siteOrigin } from "../seo/origin";
import { advanceTournaments } from "./advance-tournaments";
import { sendCheckInReminders } from "./check-in-reminders";
import { closeDueRegistrations } from "./close-registrations";
import { createDueEditions } from "./create-editions";
import { pollAllRanks } from "./poll-ranks";
import { sendPendingEmails } from "./send-emails";

const POLL_RANKS = "poll-ranks";
const EVERY_SIX_HOURS = "0 */6 * * *";
const CLOSE_REGISTRATIONS = "close-registrations";
const ADVANCE_TOURNAMENTS = "advance-tournaments";
const CREATE_EDITIONS = "create-editions";
const SEND_EMAILS = "send-emails";
const ISSUE_TOURNAMENT_CODES = "issue-tournament-codes";
const EVERY_MINUTE = "* * * * *";

export async function registerJobs(boss: PgBoss, riotFeatures: Pick<RiotFeatures, "tournamentCodes"> = features): Promise<void> {
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
    const reminders = await sendCheckInReminders(db, new Date());
    console.info(`[jobs] ${ADVANCE_TOURNAMENTS}: reminded ${reminders.reminded} captains`);
  });
  await boss.createQueue(CREATE_EDITIONS);
  await boss.schedule(CREATE_EDITIONS, EVERY_MINUTE);
  await boss.work(CREATE_EDITIONS, async () => {
    const result = await createDueEditions(db, new Date());
    console.info(`[jobs] ${CREATE_EDITIONS}: created ${result.created}`);
  });
  const mailer = env.RESEND_API_KEY
    ? createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM! })
    : createLogMailer();
  await boss.createQueue(SEND_EMAILS);
  await boss.schedule(SEND_EMAILS, EVERY_MINUTE);
  await boss.work(SEND_EMAILS, async () => {
    const result = await sendPendingEmails({ db, mailer, origin: siteOrigin(env.BETTER_AUTH_URL) }, new Date());
    console.info(`[jobs] ${SEND_EMAILS}: sent ${result.sent}, skipped ${result.skipped}, failed ${result.failed}`);
  });
  // Riot tournament codes only exist with the capability on; without it moderators post lobbies.
  if (riotFeatures.tournamentCodes) {
    const client = createRiotTournamentClient({ apiKey: env.RIOT_API_KEY, stub: env.RIOT_TOURNAMENT_STUB });
    const callbackUrl = riotCallbackUrl(siteOrigin(env.BETTER_AUTH_URL), features.resultCallbacks ? env.RIOT_CALLBACK_SECRET : undefined);
    await boss.createQueue(ISSUE_TOURNAMENT_CODES);
    await boss.schedule(ISSUE_TOURNAMENT_CODES, EVERY_MINUTE);
    await boss.work(ISSUE_TOURNAMENT_CODES, async () => {
      const result = await issueTournamentCodes({ db, client, callbackUrl }, new Date());
      console.info(`[jobs] ${ISSUE_TOURNAMENT_CODES}: issued ${result.issued}, failed ${result.failed}`);
    });
  }
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
