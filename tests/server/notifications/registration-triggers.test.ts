import { beforeEach, expect, test } from "bun:test";
import { asc, eq } from "drizzle-orm";
import { entryCredits, notifications, teamRequests } from "../../../src/server/db/schema";
import { recruitFromPool, requestFromPool, respondToPoolRequest } from "../../../src/server/pool/requests";
import { inviteByRiotId, requestToJoin, respondToRequest } from "../../../src/server/teams/teams";
import { markPaid, unmarkPaid } from "../../../src/server/tournaments/confirmations";
import { cancelTournament, closeRegistration, grantManualCredit } from "../../../src/server/tournaments/credits";
import type { Rank } from "../../../src/shared/rank";
import {
  createTestRegistration,
  createTestTeam,
  createTestTournament,
  linkedPlayer,
  poolPlayer,
} from "../../helpers/competition";
import { createTestUser, resetTestDb, testDb } from "../../helpers/db";
import { FakeRiotClient } from "../../helpers/fake-riot";

const GOLD: Rank = { tier: "GOLD", division: "II", lp: 0 };
const NOW = new Date("2026-10-30T20:00:00Z");

let admin: string;

beforeEach(async () => {
  await resetTestDb();
  admin = await createTestUser("admin");
});

const all = () => testDb.select().from(notifications).orderBy(asc(notifications.createdAt));
const of = async (userId: string) => (await all()).filter((n) => n.userId === userId);
const kinds = async (kind: string) => (await all()).filter((n) => n.kind === kind);
const ref = (t: { title: string; edition: number; slug: string }) => ({ title: t.title, edition: t.edition, slug: t.slug });

const openTournament = (overrides: Parameters<typeof createTestTournament>[0] = {}) =>
  createTestTournament({ status: "registration_open", ...overrides });

async function registered(tournamentId: string, prefix: string, count = 5) {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) ids.push(await linkedPlayer(`${prefix}${i}`, GOLD));
  const team = await createTestTeam(ids[0]!, ids.slice(1), `Equipo ${prefix}`);
  const registrationId = await createTestRegistration(tournamentId, team.id, { starters: ids, subs: [] });
  return { ids, team, captain: ids[0]!, registrationId };
}

test("an invite by Riot ID notifies the invitee once", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("inv");
  const team = await createTestTeam("cap", [], "Los Pibes");
  const result = await inviteByRiotId(testDb, "cap", team.id, "inv#LAS");
  expect(result.ok).toBe(true);
  const [note] = await of("inv");
  expect(note).toMatchObject({
    kind: "team_invite",
    payload: { kind: "team_invite", teamName: "Los Pibes", tournament: null },
    dedupeKey: `invite:${(result as { requestId: string }).requestId}:inv`,
  });
  expect(await all()).toHaveLength(1);
});

test("a refused invite writes nothing", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("mem");
  const team = await createTestTeam("cap", ["mem"], "Los Pibes");
  expect(await inviteByRiotId(testDb, "cap", team.id, "mem#LAS")).toEqual({ ok: false, reason: "already_member" });
  expect(await all()).toHaveLength(0);
});

test("a join request notifies the captain; accepting it tells the requester, declining is silent", async () => {
  await linkedPlayer("cap");
  await linkedPlayer("asker");
  await linkedPlayer("other");
  const team = await createTestTeam("cap", [], "Los Pibes");
  const request = await requestToJoin(testDb, "asker", team.id);
  if (!request.ok) throw new Error(request.reason);
  expect((await of("cap"))[0]).toMatchObject({
    payload: { kind: "join_request", teamName: "Los Pibes", playerRiotId: "asker#LAS", tournament: null },
    dedupeKey: `request:${request.requestId}:cap`,
  });

  expect(await respondToRequest(testDb, "cap", request.requestId, true)).toEqual({ ok: true });
  expect((await of("asker"))[0]).toMatchObject({
    payload: { kind: "request_accepted", teamName: "Los Pibes", teamSlug: team.slug },
    dedupeKey: `accepted:${request.requestId}:asker`,
  });

  const declined = await requestToJoin(testDb, "other", team.id);
  if (!declined.ok) throw new Error(declined.reason);
  await respondToRequest(testDb, "cap", declined.requestId, false);
  expect(await of("other")).toHaveLength(0);
});

test("pool invites and requests carry the tournament, and an accepted pool request tells the requester", async () => {
  const tournament = await openTournament();
  const team = await registered(tournament.id, "t", 3);
  await poolPlayer(tournament, "agent", GOLD);
  await poolPlayer(tournament, "asker", GOLD);

  const invite = await recruitFromPool(testDb, team.captain, team.registrationId, "agent");
  if (!invite.ok) throw new Error(invite.reason);
  expect((await of("agent"))[0]).toMatchObject({
    payload: { kind: "team_invite", teamName: "Equipo t", tournament: ref(tournament) },
    dedupeKey: `invite:${invite.requestId}:agent`,
  });

  const request = await requestFromPool(testDb, "asker", team.registrationId);
  if (!request.ok) throw new Error(request.reason);
  const captainNotes = await of(team.captain);
  expect(captainNotes.at(-1)).toMatchObject({
    payload: { kind: "join_request", teamName: "Equipo t", playerRiotId: "asker#LAS", tournament: ref(tournament) },
    dedupeKey: `request:${request.requestId}:${team.captain}`,
  });

  const deps = { db: testDb, riot: new FakeRiotClient() };
  expect(await respondToPoolRequest(deps, team.captain, request.requestId, true)).toEqual({ ok: true });
  expect((await of("asker")).at(-1)).toMatchObject({
    payload: { kind: "request_accepted", teamName: "Equipo t", teamSlug: team.team.slug },
    dedupeKey: `accepted:${request.requestId}:asker`,
  });
});

test("markPaid notifies each newly paid player once, and nothing when refused", async () => {
  const tournament = await openTournament();
  const team = await registered(tournament.id, "a");
  await markPaid(testDb, admin, tournament.id, team.ids.slice(0, 2), "MP");
  expect((await kinds("payment_recorded")).map((n) => n.userId).sort()).toEqual(team.ids.slice(0, 2));
  expect((await of(team.ids[0]!))[0]).toMatchObject({ payload: { kind: "payment_recorded", tournament: ref(tournament) } });

  await markPaid(testDb, admin, tournament.id, team.ids.slice(0, 2), "MP-2");
  expect(await kinds("payment_recorded")).toHaveLength(2);

  const closed = await createTestTournament({ status: "finished" });
  await linkedPlayer("late");
  expect(await markPaid(testDb, admin, closed.id, ["late"], "MP")).toEqual({ ok: false, reason: "invalid_state" });
  expect(await of("late")).toHaveLength(0);
});

test("a team reaching confirmed tells its roster once, even after dropping back and confirming again", async () => {
  const tournament = await openTournament();
  const team = await registered(tournament.id, "a");
  await markPaid(testDb, admin, tournament.id, team.ids, "MP");
  const confirmed = await kinds("registration_confirmed");
  expect(confirmed.map((n) => n.userId).sort()).toEqual([...team.ids].sort());
  expect(confirmed[0]).toMatchObject({
    payload: { kind: "registration_confirmed", teamName: "Equipo a", tournament: ref(tournament) },
    dedupeKey: `confirmed:${team.registrationId}:${confirmed[0]!.userId}`,
  });

  await unmarkPaid(testDb, admin, tournament.id, team.ids[4]!);
  await markPaid(testDb, admin, tournament.id, [team.ids[4]!], "MP-again");
  expect(await kinds("registration_confirmed")).toHaveLength(5);
});

test("closing with 13 pool players tells 10 about their team and credits 3; cancelling credits only the rest", async () => {
  const tournament = await openTournament();
  const ids: string[] = [];
  for (let i = 0; i < 13; i++) {
    ids.push(await poolPlayer(tournament, `fa${String(i).padStart(2, "0")}`, GOLD, ["mid"]));
    await Bun.sleep(2);
  }
  await closeRegistration(testDb, tournament.id, NOW, null);

  const placed = await kinds("auto_placed");
  expect(placed).toHaveLength(10);
  expect(placed.filter((n) => n.payload.kind === "auto_placed" && n.payload.captain)).toHaveLength(2);
  for (const note of placed) {
    if (note.payload.kind !== "auto_placed") throw new Error("kind");
    expect(note.payload.teammates).toHaveLength(4);
    expect(note.payload.teammates).not.toContain(`${note.userId}#LAS`);
    expect(note.payload.tournament).toEqual(ref(tournament));
  }
  const unplaced = await kinds("credit_granted");
  expect(unplaced.map((n) => n.userId).sort()).toEqual(ids.slice(10));
  expect(unplaced.every((n) => n.payload.kind === "credit_granted" && n.payload.reason === "unplaced")).toBe(true);

  await cancelTournament(testDb, admin, tournament.id, "lluvia");
  const cancelled = (await kinds("credit_granted")).filter((n) => n.payload.kind === "credit_granted" && n.payload.reason === "cancelled");
  expect(cancelled.map((n) => n.userId).sort()).toEqual(ids.slice(0, 10));
  const credits = await testDb.select().from(entryCredits);
  for (const note of await kinds("credit_granted")) {
    const credit = credits.find((c) => c.userId === note.userId)!;
    expect(note.dedupeKey).toBe(`credit:${credit.id}:${note.userId}`);
  }
});

test("a manual credit notifies the player", async () => {
  await createTestUser("p");
  const { creditId } = await grantManualCredit(testDb, admin, "p", "por la caída del server");
  expect((await of("p"))[0]).toMatchObject({
    payload: { kind: "credit_granted", reason: "manual", tournament: null },
    dedupeKey: `credit:${creditId}:p`,
  });
});

test("declined pool requests write nothing", async () => {
  const tournament = await openTournament();
  const team = await registered(tournament.id, "t", 3);
  await poolPlayer(tournament, "agent", GOLD);
  const invite = await recruitFromPool(testDb, team.captain, team.registrationId, "agent");
  if (!invite.ok) throw new Error(invite.reason);
  const before = (await all()).length;
  await respondToPoolRequest({ db: testDb, riot: new FakeRiotClient() }, "agent", invite.requestId, false);
  expect(await all()).toHaveLength(before);
  const [row] = await testDb.select().from(teamRequests).where(eq(teamRequests.id, invite.requestId));
  expect(row!.status).toBe("declined");
});
