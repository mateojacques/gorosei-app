import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, riotAccounts, riotLinkChallenges } from "../../../src/server/db/schema";
import { confirmRiotLink, startRiotLink } from "../../../src/server/identity/link-riot";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

const T0 = new Date("2026-10-21T12:00:00Z");
const MINUTE = 60_000;

let riot: FakeRiotClient;
let clock: Date;
const deps = () => ({ db: testDb, riot, now: () => clock, random: () => 0 });

beforeEach(async () => {
  await resetTestDb();
  clock = T0;
  riot = new FakeRiotClient().addAccount({ puuid: "p1", gameName: "Señor Café", tagLine: "LAS", profileIconId: 0 });
  await createTestUser("u1");
  await createTestUser("u2");
});

async function startAndSetIcon(userId: string) {
  const started = await startRiotLink(deps(), userId, "Señor Café#LAS");
  if (!started.ok) throw new Error(`start failed: ${started.reason}`);
  riot.setIcon("p1", started.requiredIconId);
  return started;
}

test("start rejects a malformed Riot ID", async () => {
  expect(await startRiotLink(deps(), "u1", "nohash")).toEqual({ ok: false, reason: "invalid_riot_id" });
});

test("start rejects an unknown Riot account", async () => {
  expect(await startRiotLink(deps(), "u1", "Nadie#LAS")).toEqual({ ok: false, reason: "riot_not_found" });
});

test("start reports Riot being unavailable", async () => {
  riot.setUnavailable("p1");
  expect(await startRiotLink(deps(), "u1", "Señor Café#LAS")).toEqual({ ok: false, reason: "riot_unavailable" });
});

test("start asks for an icon different from the current one, valid for 30 minutes", async () => {
  const result = await startRiotLink(deps(), "u1", "señor café#las");

  expect(result).toEqual({ ok: true, requiredIconId: 1, expiresAt: new Date(T0.getTime() + 30 * MINUTE) });
});

test("start always picks a free default icon (0..28) other than the current icon", async () => {
  for (const [random, current] of [[0.999, 28], [0.5, 14], [0, 5]] as const) {
    riot.setIcon("p1", current);
    const result = await startRiotLink({ ...deps(), random: () => random }, "u1", "Señor Café#LAS");
    if (!result.ok) throw new Error(result.reason);
    expect(result.requiredIconId).not.toBe(current);
    expect(result.requiredIconId).toBeGreaterThanOrEqual(0);
    expect(result.requiredIconId).toBeLessThanOrEqual(28);
  }
});

test("starting again replaces the existing challenge", async () => {
  await startRiotLink(deps(), "u1", "Señor Café#LAS");
  await startRiotLink({ ...deps(), random: () => 0.5 }, "u1", "Señor Café#LAS");

  const challenges = await testDb.select().from(riotLinkChallenges);
  expect(challenges).toHaveLength(1);
  expect(challenges[0]!.requiredIconId).toBe(15);
});

test("confirm without a challenge fails", async () => {
  expect(await confirmRiotLink(deps(), "u1")).toEqual({ ok: false, reason: "no_challenge" });
});

test("confirm before changing the icon is an icon mismatch", async () => {
  await startRiotLink(deps(), "u1", "Señor Café#LAS");
  expect(await confirmRiotLink(deps(), "u1")).toEqual({ ok: false, reason: "icon_mismatch" });
});

test("confirm after changing the icon links the account", async () => {
  await startAndSetIcon("u1");

  const result = await confirmRiotLink(deps(), "u1");

  if (!result.ok) throw new Error(result.reason);
  const [account] = await testDb.select().from(riotAccounts);
  expect(account).toMatchObject({ id: result.riotAccountId, userId: "u1", puuid: "p1", gameName: "Señor Café", tagLine: "LAS" });
  expect(await testDb.select().from(riotLinkChallenges)).toEqual([]);
  const audits = await testDb.select().from(auditLog).where(eq(auditLog.action, "riot_account.linked"));
  expect(audits).toHaveLength(1);
  expect(audits[0]).toMatchObject({ actorUserId: "u1", entityType: "riot_account", entityId: result.riotAccountId });
});

test("confirm after 30 minutes is expired, and a new start succeeds", async () => {
  await startAndSetIcon("u1");
  clock = new Date(T0.getTime() + 31 * MINUTE);

  expect(await confirmRiotLink(deps(), "u1")).toEqual({ ok: false, reason: "expired" });
  expect((await startRiotLink(deps(), "u1", "Señor Café#LAS")).ok).toBe(true);
});

test("a user with a linked account cannot start another link", async () => {
  await startAndSetIcon("u1");
  await confirmRiotLink(deps(), "u1");
  riot.addAccount({ puuid: "p2", gameName: "Otro", tagLine: "LAS" });

  expect(await startRiotLink(deps(), "u1", "Otro#LAS")).toEqual({ ok: false, reason: "already_linked_self" });
});

test("a Riot account linked to another user cannot be claimed", async () => {
  await startAndSetIcon("u1");
  await confirmRiotLink(deps(), "u1");

  expect(await startRiotLink(deps(), "u2", "Señor Café#LAS")).toEqual({ ok: false, reason: "taken_by_other" });
});

test("if another user links first, confirm fails and writes nothing", async () => {
  const started = await startRiotLink(deps(), "u2", "Señor Café#LAS");
  if (!started.ok) throw new Error(started.reason);
  await startRiotLink(deps(), "u1", "Señor Café#LAS");
  riot.setIcon("p1", started.requiredIconId);
  expect((await confirmRiotLink(deps(), "u1")).ok).toBe(true);

  expect(await confirmRiotLink(deps(), "u2")).toEqual({ ok: false, reason: "taken_by_other" });
  expect(await testDb.select().from(riotAccounts).where(eq(riotAccounts.userId, "u2"))).toEqual([]);
  expect(await testDb.select().from(auditLog)).toHaveLength(1);
});
