import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { teams } from "../../../src/server/db/schema";
import { listSitemapEntries } from "../../../src/server/seo/sitemap";
import { createTestTeam, createTestTournament, linkedPlayer } from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

const paths = async () => (await listSitemapEntries(testDb)).map((e) => e.path);

test("lists static pages, public tournaments, teams and linked players", async () => {
  const draft = await createTestTournament({ status: "draft" });
  const open = await createTestTournament({ status: "registration_open" });
  const finished = await createTestTournament({ status: "finished" });
  await linkedPlayer("Capi");
  await createTestUser("unlinked");
  const team = await createTestTeam("Capi");
  const entries = await listSitemapEntries(testDb);
  const list = entries.map((e) => e.path);
  expect(list).toContain("/");
  expect(list).toContain("/torneos");
  expect(list).toContain("/privacidad");
  expect(list).toContain(`/torneos/${open.slug}`);
  expect(list).toContain(`/torneos/${finished.slug}`);
  expect(list).not.toContain(`/torneos/${draft.slug}`);
  expect(list).toContain(`/equipos/${team.slug}`);
  expect(list).toContain("/jugador/Capi-LAS");
  expect(list.some((p) => p.startsWith("/partidas") || p.startsWith("/admin") || p.startsWith("/mod"))).toBe(false);
  expect(new Set(list).size).toBe(list.length);
  for (const e of entries) {
    expect(e.path.startsWith("/")).toBe(true);
    expect(Number.isNaN(e.lastmod.getTime())).toBe(false);
  }
});

test("an auto-formed team appears only once kept", async () => {
  const t = await createTestTournament({ status: "registration_open" });
  await linkedPlayer("auto1");
  const team = await createTestTeam("auto1");
  await testDb.update(teams).set({ autoFormedTournamentId: t.id }).where(eq(teams.id, team.id));
  expect(await paths()).not.toContain(`/equipos/${team.slug}`);
  await testDb.update(teams).set({ autoFormedTournamentId: null }).where(eq(teams.id, team.id));
  expect(await paths()).toContain(`/equipos/${team.slug}`);
});
