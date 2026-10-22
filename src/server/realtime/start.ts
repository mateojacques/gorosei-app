import { getSessionUser } from "../auth";
import { db } from "../db/client";
import { env } from "../env";
import { canSubscribe, startRealtimeServer } from "./server";

const state = globalThis as typeof globalThis & { __gorosei_realtime?: ReturnType<typeof startRealtimeServer> };

/** Starts the websocket server once per process. Never runs under `bun test`. */
export function startRealtime(): void {
  if (process.env.NODE_ENV === "test" || state.__gorosei_realtime) return;
  state.__gorosei_realtime = startRealtimeServer({
    port: env.REALTIME_PORT,
    authenticate: getSessionUser,
    canSubscribe: canSubscribe(db),
    allowedOrigins: [new URL(env.BETTER_AUTH_URL).origin],
  });
}
