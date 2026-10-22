import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { notifications, user } from "../../../src/server/db/schema";
import { MAX_EMAIL_ATTEMPTS, sendPendingEmails } from "../../../src/server/jobs/send-emails";
import { notify } from "../../../src/server/notifications/notify";
import { getEmailEnabled, setEmailEnabled } from "../../../src/server/notifications/settings";
import type { NotificationPayload } from "../../../src/shared/notifications";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { RecordingMailer } from "../../helpers/recording-mailer";

const origin = "https://gorosei.gg";
const cup = { title: "Copa", edition: 3, slug: "copa-3" };
const paid: NotificationPayload = { kind: "payment_recorded", tournament: cup };
const ready: NotificationPayload = { kind: "match_ready", tournament: cup, matchId: "m1", opponent: "Los Otros" };

beforeEach(async () => {
  await resetTestDb();
  await createTestUser("p");
});

const row = async () => (await testDb.select().from(notifications))[0]!;
const run = (mailer: RecordingMailer, now = new Date()) => sendPendingEmails({ db: testDb, mailer, origin }, now);

async function backdate(minutes: number) {
  await testDb.update(notifications).set({ createdAt: new Date(Date.now() - minutes * 60_000) });
}

test("a pending notification is sent once", async () => {
  await notify(testDb, ["p"], paid);
  const mailer = new RecordingMailer();
  expect(await run(mailer)).toEqual({ sent: 1, skipped: 0, failed: 0 });
  expect(mailer.sent).toHaveLength(1);
  expect(mailer.sent[0]).toMatchObject({ to: "p@test.local", subject: "Registramos tu pago" });
  expect(await row()).toMatchObject({ emailStatus: "sent", emailAttempts: 1 });
  expect((await row()).emailedAt).not.toBeNull();
  expect(await run(mailer)).toEqual({ sent: 0, skipped: 0, failed: 0 });
});

test("an opted-out player is skipped", async () => {
  expect(await getEmailEnabled(testDb, "p")).toBe(true);
  await setEmailEnabled(testDb, "p", false);
  expect(await getEmailEnabled(testDb, "p")).toBe(false);
  await notify(testDb, ["p"], paid);
  const mailer = new RecordingMailer();
  expect(await run(mailer)).toEqual({ sent: 0, skipped: 1, failed: 0 });
  expect(mailer.sent).toHaveLength(0);
  expect((await row()).emailStatus).toBe("skipped");
});

test("an account without a real address is skipped", async () => {
  await testDb.update(user).set({ email: "puuid-1@riot.invalid" }).where(eq(user.id, "p"));
  await notify(testDb, ["p"], paid);
  const mailer = new RecordingMailer();
  expect(await run(mailer)).toEqual({ sent: 0, skipped: 1, failed: 0 });
  expect(mailer.sent).toHaveLength(0);
});

test("a stale time-bound notification is skipped; other kinds still go out", async () => {
  await notify(testDb, ["p"], ready);
  await notify(testDb, ["p"], paid);
  await backdate(120);
  const mailer = new RecordingMailer();
  expect(await run(mailer)).toEqual({ sent: 1, skipped: 1, failed: 0 });
  expect(mailer.sent.map((m) => m.subject)).toEqual(["Registramos tu pago"]);
});

test("retryable failures go back to pending until the last attempt", async () => {
  await notify(testDb, ["p"], paid);
  const mailer = new RecordingMailer().failWith(
    { ok: false, retryable: true },
    { ok: false, retryable: true },
    { ok: false, retryable: true },
  );
  expect(await run(mailer)).toEqual({ sent: 0, skipped: 0, failed: 0 });
  expect(await row()).toMatchObject({ emailStatus: "pending", emailAttempts: 1 });
  await run(mailer);
  expect(await run(mailer)).toEqual({ sent: 0, skipped: 0, failed: 1 });
  expect(await row()).toMatchObject({ emailStatus: "failed", emailAttempts: MAX_EMAIL_ATTEMPTS });
  await run(mailer);
  expect(mailer.sent).toHaveLength(3);
});

test("a rejected message fails at once", async () => {
  await notify(testDb, ["p"], paid);
  const mailer = new RecordingMailer().failWith({ ok: false, retryable: false });
  expect(await run(mailer)).toEqual({ sent: 0, skipped: 0, failed: 1 });
  expect(await row()).toMatchObject({ emailStatus: "failed", emailAttempts: 1 });
});

test("two concurrent runs send each row once", async () => {
  for (let i = 0; i < 5; i++) await notify(testDb, ["p"], paid);
  const mailer = new RecordingMailer();
  await Promise.all([run(mailer), run(mailer)]);
  expect(mailer.sent).toHaveLength(5);
  expect((await testDb.select().from(notifications)).every((n) => n.emailStatus === "sent")).toBe(true);
});

test("a row stuck sending after a crash goes back to pending", async () => {
  await notify(testDb, ["p"], paid);
  await testDb
    .update(notifications)
    .set({ emailStatus: "sending", emailAttempts: 1, emailClaimedAt: new Date(Date.now() - 11 * 60_000) });
  const mailer = new RecordingMailer();
  expect(await run(mailer)).toEqual({ sent: 1, skipped: 0, failed: 0 });
  expect(await row()).toMatchObject({ emailStatus: "sent", emailAttempts: 2 });
});

test("a row claimed a moment ago is left alone", async () => {
  await notify(testDb, ["p"], paid);
  await testDb.update(notifications).set({ emailStatus: "sending", emailAttempts: 1, emailClaimedAt: new Date() });
  const mailer = new RecordingMailer();
  expect(await run(mailer)).toEqual({ sent: 0, skipped: 0, failed: 0 });
});
