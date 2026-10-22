import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog, matches, user } from "../../../src/server/db/schema";
import { getMatchView } from "../../../src/server/bracket/bracket";
import { setMatchVod } from "../../../src/server/matchday/moderation";
import { startedTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

async function setup() {
  await createTestUser("mod");
  await testDb.update(user).set({ role: "moderator" }).where(eq(user.id, "mod"));
  const s = await startedTestTournament(2, { bracket: "single_elimination" });
  const [m] = await testDb.select().from(matches).where(eq(matches.tournamentId, s.tournament.id));
  return m!;
}
const stored = async (id: string) => (await testDb.select({ v: matches.vodUrl }).from(matches).where(eq(matches.id, id)))[0]!.v;

test("a moderator sets an https VOD link; it is audited and public", async () => {
  const m = await setup();
  expect(await setMatchVod(testDb, "mod", m.id, "https://www.youtube.com/watch?v=abc")).toEqual({ ok: true });
  expect(await stored(m.id)).toBe("https://www.youtube.com/watch?v=abc");
  const audits = await testDb.select().from(auditLog).where(eq(auditLog.action, "match.vod_set"));
  expect(audits).toHaveLength(1);
  expect(audits[0]!.entityId).toBe(m.id);
  expect((await getMatchView(testDb, m.id, null, new Date()))!.vodUrl).toBe("https://www.youtube.com/watch?v=abc");
});

test("anything but a short https URL is rejected and nothing is stored", async () => {
  const m = await setup();
  for (const url of ["http://example.com/v", "javascript:alert(1)", "//example.com", `https://example.com/${"a".repeat(281)}`, "https://", "not a url"]) {
    expect(await setMatchVod(testDb, "mod", m.id, url)).toEqual({ ok: false, reason: "invalid_url" });
  }
  expect(`https://example.com/${"a".repeat(281)}`).toHaveLength(301);
  expect(await stored(m.id)).toBeNull();
});

test("null clears; an unknown match is not_found", async () => {
  const m = await setup();
  await setMatchVod(testDb, "mod", m.id, "https://twitch.tv/videos/1");
  expect(await setMatchVod(testDb, "mod", m.id, null)).toEqual({ ok: true });
  expect(await stored(m.id)).toBeNull();
  expect(await setMatchVod(testDb, "mod", crypto.randomUUID(), "https://example.com")).toEqual({ ok: false, reason: "not_found" });
});
