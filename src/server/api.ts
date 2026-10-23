import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { auth } from "./auth";
import { db } from "./db/client";
import { env } from "./env";
import { RIOT_GAME_RESULT, type RiotGameJob, handleRiotCallback } from "./riot/callback";
import { features } from "./riot/features";

type ApiOptions = { resultCallbacks: { secret: string; enqueue(job: RiotGameJob): Promise<void> } | null };

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createApi(opts: ApiOptions) {
  const api = new Hono().basePath("/api");

  api.get("/health", (c) => c.json({ ok: true }));

  api.on(["GET", "POST"], "/auth/*", (c) => auth.handler(c.req.raw));

  // Riot posts game results here; the secret in the path is the only credential, so a wrong one looks like no route.
  const callbacks = opts.resultCallbacks;
  if (callbacks) {
    api.post("/riot/callback/:secret", async (c) => {
      if (!sameSecret(c.req.param("secret"), callbacks.secret)) return c.notFound();
      const body = await c.req.json().catch(() => undefined);
      const outcome = await handleRiotCallback({ db, enqueue: callbacks.enqueue }, body);
      if (outcome === "invalid") return c.json({ ok: false }, 400);
      return c.json({ ok: true });
    });
  }
  return api;
}

async function enqueueRiotGame(job: RiotGameJob): Promise<void> {
  const { startJobs } = await import("./jobs/boss");
  const boss = await startJobs();
  await boss?.send(RIOT_GAME_RESULT, job, { singletonKey: job.riotMatchId, retryLimit: 10, retryDelay: 60, retryBackoff: true });
}

export const api = createApi({
  resultCallbacks: features.resultCallbacks ? { secret: env.RIOT_CALLBACK_SECRET!, enqueue: enqueueRiotGame } : null,
});
