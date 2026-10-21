import type { ViewerState } from "./viewer.functions";

// The shell and the landing page must render even when auth or the database is down.
export async function viewerStateOrSignedOut(load: () => Promise<ViewerState>): Promise<ViewerState> {
  try {
    return await load();
  } catch (error) {
    console.error("viewer state lookup failed", error);
    return { signedIn: false };
  }
}
