import { Hono } from "hono";

export const api = new Hono().basePath("/api");

api.get("/health", (c) => c.json({ ok: true }));
