import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { auth, getSessionUser, requireRole } from "../../src/server/auth";
import { user } from "../../src/server/db/schema";
import { resetTestDb, testDb } from "../helpers/db";

beforeEach(resetTestDb);

async function signUp(email: string, extra: Record<string, unknown> = {}) {
  const { headers } = await auth.api.signUpEmail({
    body: { name: "Jugador", email, password: "contraseña-segura-1", ...extra } as never,
    returnHeaders: true,
  });
  const cookie = headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return new Headers({ cookie });
}

async function roleOf(email: string) {
  const [row] = await testDb.select({ role: user.role }).from(user).where(eq(user.email, email));
  return row?.role;
}

test("email sign-up creates a player", async () => {
  await signUp("a@test.local");
  expect(await roleOf("a@test.local")).toBe("player");
});

test("sign-up cannot choose its own role", async () => {
  await signUp("b@test.local", { role: "admin" });
  expect(await roleOf("b@test.local")).toBe("player");
});

test("getSessionUser returns the signed-in user", async () => {
  const headers = await signUp("c@test.local");
  expect(await getSessionUser(headers)).toMatchObject({ role: "player", name: "Jugador" });
});

test("getSessionUser returns null without a session", async () => {
  expect(await getSessionUser(new Headers())).toBeNull();
});

test("requireRole rejects a player asking for moderator with 403", async () => {
  const headers = await signUp("d@test.local");
  await expect(requireRole(headers, "moderator")).rejects.toMatchObject({ status: 403 });
});

test("requireRole lets an admin act as moderator", async () => {
  const headers = await signUp("e@test.local");
  await testDb.update(user).set({ role: "admin" }).where(eq(user.email, "e@test.local"));
  expect(await requireRole(headers, "moderator")).toMatchObject({ role: "admin" });
});

test("requireRole rejects anonymous requests with 401", async () => {
  await expect(requireRole(new Headers(), "player")).rejects.toMatchObject({ status: 401 });
});
