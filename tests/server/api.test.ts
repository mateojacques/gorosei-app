import { expect, test } from "bun:test";
import { api } from "../../src/server/api";

test("GET /api/health returns ok", async () => {
  const res = await api.request("/api/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("/api/auth/* is handled by Better Auth", async () => {
  const res = await api.request("http://localhost:3000/api/auth/ok");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("Riot result callbacks are 404 while the capability is off", async () => {
  const res = await api.request("/api/riot/callback/anything", { method: "POST", body: "{}" });
  expect(res.status).toBe(404);
});

test("with callbacks on, only the right secret reaches the handler", async () => {
  const { createApi } = await import("../../src/server/api");
  const secret = "s".repeat(40);
  const on = createApi({ resultCallbacks: { secret, enqueue: async () => {} } });
  const post = (path: string, payload: string) =>
    on.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload });
  expect((await post(`/api/riot/callback/${"x".repeat(40)}`, "{}")).status).toBe(404);
  expect((await post("/api/riot/callback/short", "{}")).status).toBe(404);
  expect((await post(`/api/riot/callback/${secret}`, "not json")).status).toBe(400);
  expect((await post(`/api/riot/callback/${secret}`, JSON.stringify({ nope: 1 }))).status).toBe(400);
  const ok = await post(`/api/riot/callback/${secret}`, JSON.stringify({ shortCode: "UNKNOWN", gameId: 1 }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: true });
});
