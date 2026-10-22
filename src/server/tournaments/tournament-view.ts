import type { Db } from "../db/client";
import { describeRule } from "../../shared/eligibility";
import { prizePoolArs, splitPrize } from "../../shared/prize";
import type { RegistrationStatus } from "../../shared/tournament";
import { listRegistrations } from "./registrations";
import { type Tournament, getTournamentBySlug } from "./tournaments";

const PUBLIC_REGISTRATION_STATUSES: readonly RegistrationStatus[] = ["confirmed", "waitlisted", "pending"];

export type TournamentView = Pick<
  Tournament,
  | "id"
  | "slug"
  | "title"
  | "edition"
  | "status"
  | "startsAt"
  | "registrationClosesAt"
  | "bracket"
  | "draftMode"
  | "bestOf"
  | "finalsBestOf"
  | "teamCap"
  | "maxSubs"
  | "entryFeeArs"
  | "prizeGoalArs"
  | "prizeSplit"
  | "paymentInstructions"
  | "rulesText"
  | "streamUrl"
> & {
  poolArs: number;
  prizeShares: number[];
  goalShares: number[];
  confirmedCount: number;
  registrations: { teamName: string; teamSlug: string; status: RegistrationStatus; paidCount: number; starterCount: number }[];
  rules: string[];
};

/** The public face of a tournament; drafts are not public. */
export async function getTournamentView(db: Db, slug: string): Promise<TournamentView | null> {
  const tournament = await getTournamentBySlug(db, slug);
  if (!tournament || tournament.status === "draft") return null;
  return buildTournamentView(tournament, await listRegistrations(db, tournament.id));
}

export function buildTournamentView(
  tournament: Tournament,
  registrations: Awaited<ReturnType<typeof listRegistrations>>,
): TournamentView {
  const confirmed = registrations.filter((r) => r.status === "confirmed");
  // The pool is what confirmed rosters actually paid; subs who paid count as entries too.
  const poolArs = prizePoolArs(
    confirmed.reduce((sum, r) => sum + r.paidCount, 0),
    tournament.entryFeeArs,
  );
  const free = tournament.entryFeeArs === 0;
  return {
    id: tournament.id,
    slug: tournament.slug,
    title: tournament.title,
    edition: tournament.edition,
    status: tournament.status,
    startsAt: tournament.startsAt,
    registrationClosesAt: tournament.registrationClosesAt,
    bracket: tournament.bracket,
    draftMode: tournament.draftMode,
    bestOf: tournament.bestOf,
    finalsBestOf: tournament.finalsBestOf,
    teamCap: tournament.teamCap,
    maxSubs: tournament.maxSubs,
    entryFeeArs: tournament.entryFeeArs,
    prizeGoalArs: tournament.prizeGoalArs,
    prizeSplit: tournament.prizeSplit,
    // Free tournaments have nothing to pay, so their instructions never reach the page.
    paymentInstructions: free ? "" : tournament.paymentInstructions,
    rulesText: tournament.rulesText,
    streamUrl: tournament.streamUrl,
    poolArs,
    prizeShares: splitPrize(poolArs, tournament.prizeSplit),
    goalShares: splitPrize(tournament.prizeGoalArs, tournament.prizeSplit),
    confirmedCount: confirmed.length,
    registrations: registrations
      .filter((r) => PUBLIC_REGISTRATION_STATUSES.includes(r.status))
      .map((r) => ({
        teamName: r.team.name,
        teamSlug: r.team.slug,
        status: r.status,
        paidCount: r.paidCount,
        starterCount: r.roster.filter((p) => !p.isSub).length,
      })),
    rules: tournament.eligibilityRules.map(describeRule),
  };
}
