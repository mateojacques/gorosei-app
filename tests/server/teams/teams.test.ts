import { beforeEach, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { auditLog, teamMembers, teams } from "../../../src/server/db/schema";
import {
  cancelRequest,
  createTeam,
  createTeamRow,
  getTeamBySlug,
  inviteByRiotId,
  leaveTeam,
  listPendingRequestsForTeam,
  listPendingRequestsForUser,
  removeMember,
  renameTeam,
  requestToJoin,
  respondToRequest,
  transferCaptain,
} from "../../../src/server/teams/teams";
import { createTestTeam, createTestTournament, linkedPlayer } from "../../helpers/competition";
import { createTestRiotAccount, createTestUser, resetTestDb, testDb } from "../../helpers/db";

beforeEach(resetTestDb);

test("creating a team requires a linked Riot account", async () => {
  await createTestUser("nolink");
  expect(await createTeam(testDb, "nolink", { name: "Pibes", tag: "PBS" })).toEqual({ ok: false, reason: "riot_required" });

  await linkedPlayer("cap");
  const created = await createTeam(testDb, "cap", { name: "Pibes", tag: "PBS" });
  expect(created).toMatchObject({ ok: true, slug: "pibes" });
  if (!created.ok) return;
  const [member] = await testDb.select().from(teamMembers).where(eq(teamMembers.teamId, created.teamId));
  expect(member).toMatchObject({ userId: "cap", role: "captain" });
  const audit = await testDb.select().from(auditLog).where(eq(auditLog.action, "team.created"));
  expect(audit).toHaveLength(1);
});

test("team names are unique case-insensitively and tags are uppercased", async () => {
  await linkedPlayer("a");
  await linkedPlayer("b");
  expect((await createTeam(testDb, "a", { name: "Pibes", tag: "pbs" })).ok).toBe(true);
  const [row] = await testDb.select().from(teams);
  expect(row!.tag).toBe("PBS");
  expect(await createTeam(testDb, "b", { name: "pibes", tag: "XYZ" })).toEqual({ ok: false, reason: "name_taken" });
  expect(await createTeam(testDb, "b", { name: "Otros", tag: "Pbs" })).toEqual({ ok: false, reason: "tag_taken" });
  expect(await createTeam(testDb, "b", { name: "  ab ", tag: "XYZ" })).toEqual({ ok: false, reason: "invalid_name" });
  expect(await createTeam(testDb, "b", { name: "Otros", tag: "X" })).toEqual({ ok: false, reason: "invalid_tag" });
  expect(await createTeam(testDb, "b", { name: "Otros", tag: "ABCDEF" })).toEqual({ ok: false, reason: "invalid_tag" });
  expect(await createTeam(testDb, "b", { name: "Otros", tag: "A-B" })).toEqual({ ok: false, reason: "invalid_tag" });
});

test("symbol-only names get a fallback slug and collisions get suffixes", async () => {
  await linkedPlayer("a");
  await linkedPlayer("b");
  const first = await createTeam(testDb, "a", { name: "!!!", tag: "AA" });
  const second = await createTeam(testDb, "b", { name: "???", tag: "BB" });
  expect(first).toMatchObject({ ok: true, slug: "equipo" });
  expect(second).toMatchObject({ ok: true, slug: "equipo-2" });
});

test("a team named after a reserved route segment gets a suffixed slug", async () => {
  await linkedPlayer("cap");
  // /equipos/nuevo is the create page, so no team may own that slug.
  expect(await createTeam(testDb, "cap", { name: "Nuevo", tag: "NEW" })).toMatchObject({ ok: true, slug: "nuevo-2" });
});

test("inviting by Riot ID finds the player case-insensitively", async () => {
  await linkedPlayer("cap");
  await createTestRiotAccount("senor", { puuid: "p-senor", gameName: "Señor Café", tagLine: "LAS" });
  const team = await createTestTeam("cap");

  expect(await inviteByRiotId(testDb, "senor", team.id, "x#LAS")).toEqual({ ok: false, reason: "not_captain" });
  expect(await inviteByRiotId(testDb, "cap", team.id, "sin tag")).toEqual({ ok: false, reason: "invalid_riot_id" });
  expect(await inviteByRiotId(testDb, "cap", team.id, "nadie#LAS")).toEqual({ ok: false, reason: "player_not_found" });
  expect(await inviteByRiotId(testDb, "cap", team.id, "cap#LAS")).toEqual({ ok: false, reason: "already_member" });

  const invite = await inviteByRiotId(testDb, "cap", team.id, "señor café#las");
  expect(invite.ok).toBe(true);
  expect(await inviteByRiotId(testDb, "cap", team.id, "Señor Café#LAS")).toEqual({ ok: false, reason: "already_pending" });
  const pending = await listPendingRequestsForUser(testDb, "senor");
  expect(pending.invites).toHaveLength(1);
  expect(pending.invites[0]).toMatchObject({ teamSlug: team.slug, kind: "invite", status: "pending" });
});

test("accepting an invite adds the member; only the invited user can answer it", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("guest");
  const team = await createTestTeam("cap");
  const invite = await inviteByRiotId(testDb, "cap", team.id, "guest#LAS");
  if (!invite.ok) throw new Error("invite failed");

  expect(await respondToRequest(testDb, "cap", invite.requestId, true)).toEqual({ ok: false, reason: "not_allowed" });
  expect(await respondToRequest(testDb, "guest", invite.requestId, true)).toEqual({ ok: true });
  const [member] = await testDb
    .select()
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, "guest")));
  expect(member!.role).toBe("member");
  expect(await respondToRequest(testDb, "guest", invite.requestId, true)).toEqual({ ok: false, reason: "not_pending" });
});

test("join requests are answered by the captain only", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("joiner");
  await createTestUser("nolink");
  const team = await createTestTeam("cap");

  expect(await requestToJoin(testDb, "nolink", team.id)).toEqual({ ok: false, reason: "riot_required" });
  expect(await requestToJoin(testDb, "cap", team.id)).toEqual({ ok: false, reason: "already_member" });
  const request = await requestToJoin(testDb, "joiner", team.id);
  if (!request.ok) throw new Error("request failed");
  expect(await requestToJoin(testDb, "joiner", team.id)).toEqual({ ok: false, reason: "already_pending" });
  expect(await listPendingRequestsForTeam(testDb, team.id)).toMatchObject([{ userId: "joiner", gameName: "joiner" }]);

  expect(await respondToRequest(testDb, "joiner", request.requestId, true)).toEqual({ ok: false, reason: "not_allowed" });
  expect(await respondToRequest(testDb, "cap", request.requestId, true)).toEqual({ ok: true });
  expect((await getTeamBySlug(testDb, team.slug))!.members.map((m) => m.userId)).toEqual(["cap", "joiner"]);
});

test("the captain can't leave without transferring captaincy", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("m1");
  const team = await createTestTeam("cap", ["m1"]);

  expect(await leaveTeam(testDb, "cap", team.id)).toEqual({ ok: false, reason: "captain_must_transfer" });
  expect(await transferCaptain(testDb, "m1", team.id, "cap")).toEqual({ ok: false, reason: "not_captain" });
  expect(await transferCaptain(testDb, "cap", team.id, "nobody")).toEqual({ ok: false, reason: "not_member" });
  expect(await transferCaptain(testDb, "cap", team.id, "m1")).toEqual({ ok: true });
  expect(await leaveTeam(testDb, "cap", team.id)).toEqual({ ok: true });

  const view = await getTeamBySlug(testDb, team.slug);
  expect(view!.captainUserId).toBe("m1");
  expect(view!.members).toMatchObject([{ userId: "m1", role: "captain" }]);
  expect(await leaveTeam(testDb, "cap", team.id)).toEqual({ ok: false, reason: "not_member" });
});

test("the captain can remove members but not themselves", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("m1");
  const team = await createTestTeam("cap", ["m1"]);
  expect(await removeMember(testDb, "m1", team.id, "cap")).toEqual({ ok: false, reason: "not_captain" });
  expect(await removeMember(testDb, "cap", team.id, "cap")).toEqual({ ok: false, reason: "not_member" });
  expect(await removeMember(testDb, "cap", team.id, "m1")).toEqual({ ok: true });
  expect(await removeMember(testDb, "cap", team.id, "m1")).toEqual({ ok: false, reason: "not_member" });
});

test("getTeamBySlug lists members with their current rank", async () => {
  await linkedPlayer("cap", { tier: "GOLD", division: "II", lp: 40 });
  await linkedPlayer("m1");
  const team = await createTestTeam("cap", ["m1"], "Los Pibes");
  const view = await getTeamBySlug(testDb, team.slug);
  expect(view!.name).toBe("Los Pibes");
  expect(view!.members).toEqual([
    { userId: "cap", gameName: "cap", tagLine: "LAS", role: "captain", currentRank: { tier: "GOLD", division: "II", lp: 40 } },
    { userId: "m1", gameName: "m1", tagLine: "LAS", role: "member", currentRank: null },
  ]);
  expect(await getTeamBySlug(testDb, "nope")).toBeNull();
});

test("requesting to join a missing team returns team_not_found", async () => {
  await linkedPlayer("joiner");
  expect(await requestToJoin(testDb, "joiner", crypto.randomUUID())).toEqual({ ok: false, reason: "team_not_found" });
});

test("concurrent join requests resolve to one request and already_pending", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("joiner");
  const team = await createTestTeam("cap");
  const results = await Promise.all([requestToJoin(testDb, "joiner", team.id), requestToJoin(testDb, "joiner", team.id)]);
  expect(results.filter((r) => r.ok)).toHaveLength(1);
  expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: "already_pending" });
});

test("declining a request adds no member and frees the slot for a new request", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("joiner");
  const team = await createTestTeam("cap");
  const request = await requestToJoin(testDb, "joiner", team.id);
  if (!request.ok) throw new Error("request failed");
  expect(await respondToRequest(testDb, "cap", request.requestId, false)).toEqual({ ok: true });
  expect((await getTeamBySlug(testDb, team.slug))!.members.map((m) => m.userId)).toEqual(["cap"]);
  expect(await respondToRequest(testDb, "cap", request.requestId, true)).toEqual({ ok: false, reason: "not_pending" });
  expect((await requestToJoin(testDb, "joiner", team.id)).ok).toBe(true);
});

test("the captain cancels an invite and the requester cancels a join request", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("guest");
  await linkedPlayer("joiner");
  const team = await createTestTeam("cap");
  const invite = await inviteByRiotId(testDb, "cap", team.id, "guest#LAS");
  const request = await requestToJoin(testDb, "joiner", team.id);
  if (!invite.ok || !request.ok) throw new Error("setup failed");

  expect(await cancelRequest(testDb, "guest", invite.requestId)).toEqual({ ok: false, reason: "not_allowed" });
  expect(await cancelRequest(testDb, "cap", request.requestId)).toEqual({ ok: false, reason: "not_allowed" });
  expect(await cancelRequest(testDb, "cap", invite.requestId)).toEqual({ ok: true });
  expect(await cancelRequest(testDb, "joiner", request.requestId)).toEqual({ ok: true });
  expect(await cancelRequest(testDb, "cap", invite.requestId)).toEqual({ ok: false, reason: "not_pending" });
  expect(await cancelRequest(testDb, "cap", crypto.randomUUID())).toEqual({ ok: false, reason: "not_pending" });
  expect(await respondToRequest(testDb, "guest", invite.requestId, true)).toEqual({ ok: false, reason: "not_pending" });
  expect((await listPendingRequestsForTeam(testDb, team.id))).toHaveLength(0);
});

test("renameTeam validates like createTeam, is captain-only, and keeps an auto-formed team", async () => {
  const tournament = await createTestTournament();
  await linkedPlayer("cap");
  await linkedPlayer("other");
  const team = await testDb.transaction((tx) =>
    createTeamRow(tx, { name: "Agentes libres 1-1", tag: "AL0", captainUserId: "cap", autoFormedTournamentId: tournament.id }),
  );
  await createTeam(testDb, "other", { name: "Ocupado", tag: "OCU" });

  expect(await renameTeam(testDb, "other", team.id, { name: "Pibes", tag: "PBS" })).toEqual({ ok: false, reason: "not_captain" });
  expect(await renameTeam(testDb, "cap", team.id, { name: "ab", tag: "PBS" })).toEqual({ ok: false, reason: "invalid_name" });
  expect(await renameTeam(testDb, "cap", team.id, { name: "Pibes", tag: "x" })).toEqual({ ok: false, reason: "invalid_tag" });
  expect(await renameTeam(testDb, "cap", team.id, { name: "ocupado", tag: "PBS" })).toEqual({ ok: false, reason: "name_taken" });
  expect(await renameTeam(testDb, "cap", team.id, { name: "Pibes", tag: "ocu" })).toEqual({ ok: false, reason: "tag_taken" });
  const [untouched] = await testDb.select().from(teams).where(eq(teams.id, team.id));
  expect(untouched!.autoFormedTournamentId).toBe(tournament.id);

  expect(await renameTeam(testDb, "cap", team.id, { name: "Pibes", tag: "pbs" })).toEqual({ ok: true });
  const [renamed] = await testDb.select().from(teams).where(eq(teams.id, team.id));
  expect(renamed).toMatchObject({ name: "Pibes", tag: "PBS", autoFormedTournamentId: null });
  expect(await testDb.select().from(auditLog).where(eq(auditLog.action, "team.renamed"))).toHaveLength(1);
  // keeping the same name and tag is not a clash with itself
  expect(await renameTeam(testDb, "cap", team.id, { name: "Pibes", tag: "PBS" })).toEqual({ ok: true });
});

test("getTeamHistory lists confirmed registrations with placements, newest first", async () => {
  const { getTeamHistory } = await import("../../../src/server/teams/teams");
  const { createTestRegistration } = await import("../../helpers/competition");
  const { brackets, registrations, tournaments } = await import("../../../src/server/db/schema");
  const ids = await Promise.all(["h1", "h2", "h3", "h4", "h5"].map((id) => linkedPlayer(id)));
  const team = await createTestTeam(ids[0]!, ids.slice(1), "Historia");
  expect(await getTeamHistory(testDb, team.id)).toEqual([]);

  const at = (day: number) => ({ startsAt: new Date(Date.UTC(2026, 10, day, 20)), registrationClosesAt: new Date(Date.UTC(2026, 10, day, 10)) });
  const older = await createTestTournament({ status: "registration_open", entryFeeArs: 0, title: "Copa Vieja", ...at(1) });
  const newer = await createTestTournament({ status: "registration_open", entryFeeArs: 0, title: "Copa Nueva", ...at(8) });
  const pending = await createTestTournament({ status: "registration_open", ...at(15) });
  const olderReg = await createTestRegistration(older.id, team.id, { starters: ids, subs: [] });
  await createTestRegistration(newer.id, team.id, { starters: ids, subs: [] });
  await createTestRegistration(pending.id, team.id, { starters: ids, subs: [] });
  await testDb.update(tournaments).set({ status: "finished" }).where(eq(tournaments.id, older.id));
  await testDb.insert(brackets).values({ tournamentId: older.id, data: {} as never, stageId: 0, finalStandings: [{ registrationId: olderReg, rank: 3 }] });
  expect((await testDb.select().from(registrations).where(eq(registrations.tournamentId, pending.id)))[0]!.status).toBe("pending");

  expect(await getTeamHistory(testDb, team.id)).toEqual([
    { title: "Copa Nueva", edition: newer.edition, slug: newer.slug, startsAt: newer.startsAt, status: "registration_open", placement: null },
    { title: "Copa Vieja", edition: older.edition, slug: older.slug, startsAt: older.startsAt, status: "finished", placement: 3 },
  ]);
});

test("an auto-formed team's history works the same", async () => {
  const { getTeamHistory } = await import("../../../src/server/teams/teams");
  const { createTestRegistration } = await import("../../helpers/competition");
  const ids = await Promise.all(["a1", "a2", "a3", "a4", "a5"].map((id) => linkedPlayer(id)));
  const t = await createTestTournament({ status: "registration_open", entryFeeArs: 0 });
  const team = await createTestTeam(ids[0]!, ids.slice(1), "Auto");
  await testDb.update(teams).set({ autoFormedTournamentId: t.id }).where(eq(teams.id, team.id));
  await createTestRegistration(t.id, team.id, { starters: ids, subs: [] });
  expect((await getTeamHistory(testDb, team.id)).map((h) => h.slug)).toEqual([t.slug]);
});
