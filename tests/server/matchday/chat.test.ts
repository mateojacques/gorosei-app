import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { matches } from "../../../src/server/db/schema";
import { canAccessMatchChat, listMessages, postMessage } from "../../../src/server/matchday/chat";
import { postLobby } from "../../../src/server/matchday/reports";
import { subscribe } from "../../../src/server/realtime/hub";
import { startedTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

async function setup() {
  const { tournament, teams } = await startedTestTournament(2, { bracket: "single_elimination" });
  const [match] = await testDb.select().from(matches).where(eq(matches.status, "open"));
  const mod = { id: await createTestUser("mod"), role: "moderator" as const };
  const outsider = { id: await createTestUser("outsider"), role: "player" as const };
  const a = teams.find((t) => t.registrationId === match!.reg1Id)!;
  return { tournament, match: match!, a, mod, outsider };
}

test("a player outside both teams cannot read, post or subscribe", async () => {
  const { match, outsider } = await setup();
  expect(await canAccessMatchChat(testDb, outsider, match.id)).toBe(false);
  expect(await postMessage(testDb, outsider, match.id, "hola")).toEqual({ ok: false, reason: "forbidden" });
  expect(await listMessages(testDb, outsider, match.id)).toBeNull();
  expect(await canAccessMatchChat(testDb, outsider, crypto.randomUUID())).toBe(false);
});

test("any rostered player of either team, including the bench, can chat; moderators on any match", async () => {
  const { match, a, mod } = await setup();
  const captain = { id: a.captain, role: "player" as const };
  const sub = { id: a.sub, role: "player" as const };
  expect((await postMessage(testDb, captain, match.id, "  gl hf  ")).ok).toBe(true);
  expect((await postMessage(testDb, sub, match.id, "yo")).ok).toBe(true);
  expect((await postMessage(testDb, mod, match.id, "lobby en 5")).ok).toBe(true);
  const messages = (await listMessages(testDb, captain, match.id))!;
  expect(messages.map((m) => m.body)).toEqual(["gl hf", "yo", "lobby en 5"]);
  expect(messages[0]!.authorRiotId).toBe("s0p1#LAS");
});

test("empty and 1001-character bodies are refused", async () => {
  const { match, a } = await setup();
  const captain = { id: a.captain, role: "player" as const };
  expect(await postMessage(testDb, captain, match.id, "   ")).toEqual({ ok: false, reason: "empty" });
  expect(await postMessage(testDb, captain, match.id, "x".repeat(1001))).toEqual({ ok: false, reason: "too_long" });
  expect((await postMessage(testDb, captain, match.id, "x".repeat(1000))).ok).toBe(true);
});

test("a <script> body is stored verbatim", async () => {
  const { match, a } = await setup();
  const result = await postMessage(testDb, { id: a.captain, role: "player" }, match.id, "<script>alert(1)</script>");
  expect(result).toMatchObject({ ok: true, message: { body: "<script>alert(1)</script>" } });
});

test("a post publishes on chat:<matchId>", async () => {
  const { match, a } = await setup();
  const seen: { type: string; body?: string }[] = [];
  const off = subscribe(`chat:${match.id}`, (e) => seen.push({ type: e.type, body: (e.data as { body: string }).body }));
  await postMessage(testDb, { id: a.captain, role: "player" }, match.id, "hola");
  off();
  expect(seen).toEqual([{ type: "message", body: "hola" }]);
});

test("system and lobby lines come back in order", async () => {
  const { match, a, mod } = await setup();
  await postLobby(testDb, mod.id, match.id, { name: "sala-1", password: "pw" });
  await postMessage(testDb, { id: a.captain, role: "player" }, match.id, "entramos");
  const messages = (await listMessages(testDb, mod, match.id))!;
  expect(messages.map((m) => [m.kind, m.body])).toEqual([
    ["lobby", "sala-1"],
    ["message", "entramos"],
  ]);
});

test("paging: limit keeps the newest messages, oldest first, and before pages backwards", async () => {
  const { match, a } = await setup();
  const captain = { id: a.captain, role: "player" as const };
  const base = new Date("2026-11-01T20:00:00Z").getTime();
  for (let i = 0; i < 5; i++) await postMessage(testDb, captain, match.id, `m${i}`, new Date(base + i * 1000));
  expect((await listMessages(testDb, captain, match.id, { limit: 2 }))!.map((m) => m.body)).toEqual(["m3", "m4"]);
  expect((await listMessages(testDb, captain, match.id, { limit: 2, before: new Date(base + 3000) }))!.map((m) => m.body)).toEqual(["m1", "m2"]);
});

test("24 hours after the result is confirmed players get closed; moderators can still post", async () => {
  const { match, a, mod } = await setup();
  const confirmedAt = new Date("2026-11-01T21:00:00Z");
  await testDb.update(matches).set({ status: "completed", confirmedAt }).where(eq(matches.id, match.id));
  const captain = { id: a.captain, role: "player" as const };
  const within = new Date(confirmedAt.getTime() + 23 * 3_600_000);
  const after = new Date(confirmedAt.getTime() + 25 * 3_600_000);
  expect((await postMessage(testDb, captain, match.id, "gg", within)).ok).toBe(true);
  expect(await postMessage(testDb, captain, match.id, "gg2", after)).toEqual({ ok: false, reason: "closed" });
  expect((await postMessage(testDb, mod, match.id, "cerrado", after)).ok).toBe(true);
});
