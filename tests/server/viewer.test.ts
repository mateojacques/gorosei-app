import { expect, test } from "bun:test";
import { viewerStateOrSignedOut } from "../../src/server/viewer";

test("a failing viewer lookup degrades to signed out instead of breaking the page", async () => {
  const state = await viewerStateOrSignedOut(async () => {
    throw new Error("database unreachable");
  });
  expect(state).toEqual({ signedIn: false });
});

test("a successful lookup passes through", async () => {
  const signedIn = { signedIn: true as const, userId: "u", role: "player" as const, riotAccount: null, unreadNotifications: 0 };
  const state = await viewerStateOrSignedOut(async () => signedIn);
  expect(state).toEqual(signedIn);
});

test("a signed-in viewer carries their id and unread notification count", async () => {
  const { resetTestDb, createTestRiotAccount, testDb } = await import("../helpers/db");
  const { notify } = await import("../../src/server/notifications/notify");
  const { viewerStateFor } = await import("../../src/server/viewer");
  await resetTestDb();
  await createTestRiotAccount("v", { puuid: "puuid-v", gameName: "Vos", tagLine: "LAS" });
  await createTestRiotAccount("o", { puuid: "puuid-o", gameName: "Otro", tagLine: "LAS" });
  const payload = { kind: "team_invite" as const, teamName: "Los Pibes", tournament: null };
  await notify(testDb, ["v", "o"], payload, "1");
  await notify(testDb, ["v"], payload, "2");
  expect(await viewerStateFor(testDb, { id: "v", name: "v", role: "player" })).toEqual({
    signedIn: true,
    userId: "v",
    role: "player",
    riotAccount: { gameName: "Vos", tagLine: "LAS" },
    unreadNotifications: 2,
  });
});
