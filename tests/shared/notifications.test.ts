import { describe, expect, test } from "bun:test";
import {
  EMAIL_TTL_MS,
  notificationHref,
  notificationText,
  type NotificationPayload,
} from "../../src/shared/notifications";

const cup = { title: "Copa Semanal LAS", edition: 13, slug: "copa-semanal-las-13" };
const closesAt = "2026-10-24T20:50:00.000Z";

const fixtures: NotificationPayload[] = [
  { kind: "team_invite", teamName: "Los Pibes", tournament: null },
  { kind: "team_invite", teamName: "Los Pibes", tournament: cup },
  { kind: "join_request", teamName: "Los Pibes", playerRiotId: "Faker#LAS", tournament: null },
  { kind: "join_request", teamName: "Los Pibes", playerRiotId: "Faker#LAS", tournament: cup },
  { kind: "request_accepted", teamName: "Los Pibes", teamSlug: "los-pibes" },
  { kind: "payment_recorded", tournament: cup },
  { kind: "registration_confirmed", teamName: "Los Pibes", tournament: cup },
  { kind: "auto_placed", teamName: "Equipo 1", teamSlug: "equipo-1", teammates: ["A#1", "B#2"], captain: true, tournament: cup },
  { kind: "auto_placed", teamName: "Equipo 1", teamSlug: "equipo-1", teammates: ["A#1", "B#2"], captain: false, tournament: cup },
  { kind: "credit_granted", reason: "unconfirmed", tournament: cup },
  { kind: "credit_granted", reason: "waitlisted", tournament: cup },
  { kind: "credit_granted", reason: "unplaced", tournament: cup },
  { kind: "credit_granted", reason: "cancelled", tournament: cup },
  { kind: "credit_granted", reason: "manual", tournament: null },
  { kind: "check_in_open", tournament: cup, closesAt },
  { kind: "check_in_reminder", tournament: cup, missing: 1, closesAt },
  { kind: "match_ready", tournament: cup, matchId: "m1", opponent: "Los Otros" },
  { kind: "result_confirmed", tournament: cup, matchId: "m1", won: true, score: [2, 1] },
  { kind: "result_confirmed", tournament: cup, matchId: "m1", won: false, score: [0, 2] },
  { kind: "match_disputed", tournament: cup, matchId: "m1" },
];

describe("notificationText", () => {
  for (const payload of fixtures) {
    test(`${payload.kind} reads complete`, () => {
      const { title, body } = notificationText(payload);
      expect(title.length).toBeGreaterThan(0);
      expect(body.length).toBeGreaterThan(0);
      expect(`${title} ${body}`).not.toMatch(/\{\w+\}/);
      if ("teamName" in payload) expect(`${title} ${body}`).toContain(payload.teamName);
      if ("tournament" in payload && payload.tournament) expect(`${title} ${body}`).toContain("#13");
    });
  }

  test("check-in reminder counts players", () => {
    const text = (missing: number) => notificationText({ kind: "check_in_reminder", tournament: cup, missing, closesAt }).body;
    expect(text(1)).toContain("falta 1 jugador");
    expect(text(2)).toContain("faltan 2 jugadores");
  });

  test("each credit reason has its own body", () => {
    const bodies = fixtures.filter((p) => p.kind === "credit_granted").map((p) => notificationText(p).body);
    expect(new Set(bodies).size).toBe(bodies.length);
  });

  test("result shows the score from the player's side", () => {
    expect(notificationText(fixtures[17]!).title).toContain("2-1");
    expect(notificationText(fixtures[18]!).title).toContain("0-2");
  });

  test("match ready names the opponent", () => {
    expect(notificationText(fixtures[16]!).title).toContain("Los Otros");
  });
});

describe("notificationHref", () => {
  test("match kinds go to the match", () => {
    expect(notificationHref(fixtures[16]!)).toBe("/partidas/m1");
    expect(notificationHref(fixtures[17]!)).toBe("/partidas/m1");
    expect(notificationHref(fixtures[19]!)).toBe("/partidas/m1");
  });
  test("tournament kinds go to the tournament", () => {
    for (const p of [fixtures[5]!, fixtures[6]!, fixtures[9]!, fixtures[14]!, fixtures[15]!]) {
      expect(notificationHref(p)).toBe("/torneos/copa-semanal-las-13");
    }
  });
  test("invites and requests go to the pool when they come from one", () => {
    expect(notificationHref(fixtures[0]!)).toBe("/mis-equipos");
    expect(notificationHref(fixtures[1]!)).toBe("/torneos/copa-semanal-las-13/agentes-libres");
    expect(notificationHref(fixtures[2]!)).toBe("/mis-equipos");
    expect(notificationHref(fixtures[3]!)).toBe("/torneos/copa-semanal-las-13/agentes-libres");
  });
  test("team kinds go to the team", () => {
    expect(notificationHref(fixtures[4]!)).toBe("/equipos/los-pibes");
    expect(notificationHref(fixtures[7]!)).toBe("/equipos/equipo-1");
  });
  test("every href is a path", () => {
    for (const p of fixtures) expect(notificationHref(p)).toMatch(/^\/[^/]/);
  });
});

test("time-bound kinds expire for email after an hour", () => {
  expect(EMAIL_TTL_MS.match_ready).toBe(3_600_000);
  expect(EMAIL_TTL_MS.check_in_open).toBe(3_600_000);
  expect(EMAIL_TTL_MS.check_in_reminder).toBe(3_600_000);
  expect(EMAIL_TTL_MS.payment_recorded).toBe(7 * 86_400_000);
});
