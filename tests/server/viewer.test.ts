import { expect, test } from "bun:test";
import { viewerStateOrSignedOut } from "../../src/server/viewer";

test("a failing viewer lookup degrades to signed out instead of breaking the page", async () => {
  const state = await viewerStateOrSignedOut(async () => {
    throw new Error("database unreachable");
  });
  expect(state).toEqual({ signedIn: false });
});

test("a successful lookup passes through", async () => {
  const state = await viewerStateOrSignedOut(async () => ({ signedIn: true, riotAccount: null }));
  expect(state).toEqual({ signedIn: true, riotAccount: null });
});
