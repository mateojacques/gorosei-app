import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { notifications } from "../../../src/server/db/schema";
import { countUnread, listNotifications, markAllRead } from "../../../src/server/notifications/inbox";
import { listenForNotifications } from "../../../src/server/notifications/listen";
import { notify } from "../../../src/server/notifications/notify";
import type { RealtimeEvent } from "../../../src/server/realtime/hub";
import type { NotificationPayload } from "../../../src/shared/notifications";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

const payload: NotificationPayload = { kind: "team_invite", teamName: "Los Pibes", tournament: null };

beforeEach(async () => {
  await resetTestDb();
  await createTestUser("a");
  await createTestUser("b");
});

async function listen() {
  const received: string[] = [];
  const sub = await testDb.$client.listen("notifications", (id) => received.push(id));
  return { received, stop: () => sub.unlisten() };
}

const settle = () => new Promise((r) => setTimeout(r, 500));

test("one row per distinct user", async () => {
  expect(await notify(testDb, ["a", "b"], payload)).toBe(2);
  expect(await notify(testDb, ["a", "a", "b"], payload)).toBe(2);
  expect(await testDb.select().from(notifications)).toHaveLength(4);
});

test("a repeated dedupe key notifies once", async () => {
  expect(await notify(testDb, ["a"], payload, "invite:1")).toBe(1);
  expect(await notify(testDb, ["a"], payload, "invite:1")).toBe(0);
  expect(await notify(testDb, ["b"], payload, "invite:1")).toBe(1);
});

test("the row stores the href and starts unread and pending", async () => {
  await notify(testDb, ["a"], payload);
  const [row] = await testDb.select().from(notifications).where(eq(notifications.userId, "a"));
  expect(row).toMatchObject({ kind: "team_invite", href: "/mis-equipos", readAt: null, emailStatus: "pending", emailAttempts: 0 });
});

test("a rolled-back transaction leaves no row and no ping", async () => {
  const { received, stop } = await listen();
  await testDb
    .transaction(async (tx) => {
      await notify(tx, ["a"], payload);
      throw new Error("rollback");
    })
    .catch(() => {});
  await settle();
  await stop();
  expect(await testDb.select().from(notifications)).toHaveLength(0);
  expect(received).toEqual([]);
});

test("a committed transaction pings each inserted user", async () => {
  const { received, stop } = await listen();
  await testDb.transaction(async (tx) => {
    await notify(tx, ["a", "b"], payload, "k");
    await notify(tx, ["a"], payload, "k");
  });
  await settle();
  await stop();
  expect(received.sort()).toEqual(["a", "b"]);
});

test("listenForNotifications publishes a contentless user event", async () => {
  const events: RealtimeEvent[] = [];
  const stop = await listenForNotifications(testDb.$client, (e) => events.push(e));
  await notify(testDb, ["a"], payload);
  await settle();
  await stop();
  expect(events).toEqual([{ channel: "user:a", type: "notification" }]);
});

test("inbox lists newest first and counts only the user's unread rows", async () => {
  await notify(testDb, ["a"], payload, "1");
  await new Promise((r) => setTimeout(r, 10));
  await notify(testDb, ["a"], { kind: "payment_recorded", tournament: { title: "Copa", edition: 1, slug: "copa-1" } }, "2");
  await notify(testDb, ["b"], payload, "3");
  const items = await listNotifications(testDb, "a");
  expect(items.map((i) => i.payload.kind)).toEqual(["payment_recorded", "team_invite"]);
  expect(items[0]).toMatchObject({ href: "/torneos/copa-1", read: false });
  expect(await countUnread(testDb, "a")).toBe(2);
  expect(await countUnread(testDb, "b")).toBe(1);
});

test("markAllRead leaves newer rows unread", async () => {
  await notify(testDb, ["a"], payload, "1");
  const [first] = await listNotifications(testDb, "a");
  await new Promise((r) => setTimeout(r, 10));
  await notify(testDb, ["a"], payload, "2");
  await markAllRead(testDb, "a", first!.createdAt);
  expect(await countUnread(testDb, "a")).toBe(1);
  expect(await countUnread(testDb, "b")).toBe(0);
});
