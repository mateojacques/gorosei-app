import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import type { Role } from "./auth";

export type ViewerState =
  | { signedIn: false }
  | {
      signedIn: true;
      userId: string;
      role: Role;
      riotAccount: { gameName: string; tagLine: string } | null;
      unreadNotifications: number;
    };

export const getViewerState = createServerFn({ method: "GET" }).handler(async (): Promise<ViewerState> => {
  const { viewerStateOrSignedOut } = await import("./viewer");
  return viewerStateOrSignedOut(loadViewerState);
});

async function loadViewerState(): Promise<ViewerState> {
  // Server-only modules are imported inside the function so they never reach the client bundle.
  const { getSessionUser } = await import("./auth");
  const user = await getSessionUser(getRequestHeaders());
  if (!user) return { signedIn: false };

  const [{ db }, { viewerStateFor }] = await Promise.all([import("./db/client"), import("./viewer")]);
  return viewerStateFor(db, user);
}

/** The public origin for canonical URLs, Open Graph and JSON-LD. */
export const getSiteOrigin = createServerFn({ method: "GET" }).handler(async (): Promise<string> => {
  const { configuredSiteOrigin } = await import("./seo/origin");
  return configuredSiteOrigin();
});
