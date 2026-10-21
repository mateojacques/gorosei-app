import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auditLog } from "../../../src/server/db/schema";
import {
  createTournament,
  getFeaturedTournament,
  openRegistration,
  updateTournament,
} from "../../../src/server/tournaments/tournaments";
import { baseTournamentInput, createTestTournament } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

beforeEach(async () => {
  await resetTestDb();
  await createTestUser("admin");
});

test("creates drafts with unique slugs and audit rows", async () => {
  const a = await createTournament(testDb, "admin", baseTournamentInput);
  const b = await createTournament(testDb, "admin", baseTournamentInput);
  expect(a.slug).toBe("copa-semanal-las-1");
  expect(b.slug).toBe("copa-semanal-las-1-2");
  const rows = await testDb.select().from(auditLog).where(eq(auditLog.action, "tournament.created"));
  expect(rows).toHaveLength(2);
});

test("openRegistration moves draft to registration_open once", async () => {
  const t = await createTestTournament();
  expect(await openRegistration(testDb, "admin", t.id)).toEqual({ ok: true });
  expect(await openRegistration(testDb, "admin", t.id)).toEqual({ ok: false, reason: "invalid_state" });
  expect(await openRegistration(testDb, "admin", crypto.randomUUID())).toEqual({ ok: false, reason: "not_found" });
});

test("a cancelled tournament is not editable", async () => {
  const t = await createTestTournament({ status: "cancelled" });
  expect(await updateTournament(testDb, "admin", t.id, baseTournamentInput)).toEqual({ ok: false, reason: "not_editable" });
});

test("updates a draft and audits it", async () => {
  const t = await createTestTournament();
  expect(await updateTournament(testDb, "admin", t.id, { ...baseTournamentInput, teamCap: 8 })).toEqual({ ok: true });
  const rows = await testDb.select().from(auditLog).where(eq(auditLog.action, "tournament.updated"));
  expect(rows).toHaveLength(1);
});

test("featured prefers an open tournament over an earlier closed one and ignores drafts", async () => {
  await createTestTournament({ startsAt: new Date("2026-11-01T20:00:00Z"), status: "draft" });
  expect(await getFeaturedTournament(testDb)).toBeNull();
  const closed = await createTestTournament({ startsAt: new Date("2026-11-02T20:00:00Z"), status: "registration_closed" });
  expect((await getFeaturedTournament(testDb))?.id).toBe(closed.id);
  const open = await createTestTournament({
    startsAt: new Date("2026-12-01T20:00:00Z"),
    registrationClosesAt: new Date("2026-11-30T20:00:00Z"),
    status: "registration_open",
  });
  expect((await getFeaturedTournament(testDb))?.id).toBe(open.id);
});
