import { Hono } from "hono";
import { auth } from "./auth";

export const api = new Hono().basePath("/api");

api.get("/health", (c) => c.json({ ok: true }));

api.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));
