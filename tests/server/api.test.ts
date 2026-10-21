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
