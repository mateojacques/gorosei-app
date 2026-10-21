import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import type { Role } from "./auth";

export type ViewerState =
  | { signedIn: false }
  | { signedIn: true; role: Role; riotAccount: { gameName: string; tagLine: string } | null };

export const getViewerState = createServerFn({ method: "GET" }).handler(async (): Promise<ViewerState> => {
  const { viewerStateOrSignedOut } = await import("./viewer");
  return viewerStateOrSignedOut(loadViewerState);
});

async function loadViewerState(): Promise<ViewerState> {
  // Server-only modules are imported inside the function so they never reach the client bundle.
  const { getSessionUser } = await import("./auth");
  const user = await getSessionUser(getRequestHeaders());
  if (!user) return { signedIn: false };

  const [{ db }, { riotAccounts }] = await Promise.all([import("./db/client"), import("./db/schema")]);
  const [riotAccount] = await db
    .select({ gameName: riotAccounts.gameName, tagLine: riotAccounts.tagLine })
    .from(riotAccounts)
    .where(eq(riotAccounts.userId, user.id));
  return { signedIn: true, role: user.role, riotAccount: riotAccount ?? null };
}
