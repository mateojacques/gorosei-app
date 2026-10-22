import { tournamentSchedule, tournamentStage } from "../../shared/stage";
import { twitchChannel } from "../../shared/twitch";
import { getBracketView } from "../bracket/bracket-view";
import type { Db } from "../db/client";
import { getNextTournament, getTournamentResults } from "./results";
import { getTournamentView } from "./tournament-view";
import { getViewerTournamentStatus } from "./viewer-status";

/**
 * Everything the stage-aware tournament page shows, loaded only as the stage needs it.
 * Null for drafts and unknown slugs.
 */
export async function loadTournamentPage(db: Db, slug: string, viewer: { userId: string } | null, _now: Date) {
  const view = await getTournamentView(db, slug);
  if (!view) return null;
  const stage = tournamentStage(view.status);
  if (!stage) return null;

  const hasBracketStage = view.status === "check_in" || view.status === "live" || view.status === "finished" || view.status === "cancelled";
  const [bracketView, results, next, viewerStatus] = await Promise.all([
    hasBracketStage ? getBracketView(db, view.id) : null,
    view.status === "finished" ? getTournamentResults(db, view.id, view.prizeShares) : null,
    stage === "after" ? getNextTournament(db, { id: view.id, startsAt: view.startsAt }) : null,
    viewer && stage !== "after" ? getViewerTournamentStatus(db, viewer.userId, view.id) : null,
  ]);
  return {
    ...view,
    stage,
    schedule: tournamentSchedule(view),
    bracketView,
    results,
    next,
    // The checklist is for before the cup; once live the page only needs the viewer's team to highlight it.
    viewerStatus: stage === "before" ? viewerStatus : null,
    viewerRegistrationId: viewerStatus?.registration?.registrationId ?? null,
    streamChannel: twitchChannel(view.streamUrl),
  };
}

export type TournamentPage = NonNullable<Awaited<ReturnType<typeof loadTournamentPage>>>;
