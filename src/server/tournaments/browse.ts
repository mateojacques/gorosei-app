import { and, count, desc, eq, inArray, notInArray } from "drizzle-orm";
import { FINISHED_LIMIT, filterTournaments, groupForBrowse, rankBracketOf } from "../../shared/browse";
import type { BrowseSearch, BrowseTournament } from "../../shared/browse";
import type { Db } from "../db/client";
import { registrations, tournaments } from "../db/schema";

const columns = {
  id: tournaments.id,
  slug: tournaments.slug,
  title: tournaments.title,
  edition: tournaments.edition,
  status: tournaments.status,
  startsAt: tournaments.startsAt,
  bracket: tournaments.bracket,
  entryFeeArs: tournaments.entryFeeArs,
  prizeGoalArs: tournaments.prizeGoalArs,
  prizeSplit: tournaments.prizeSplit,
  teamCap: tournaments.teamCap,
  eligibilityRules: tournaments.eligibilityRules,
};

/** Every public tournament for the browse page; finished ones limited to the most recent few. */
export async function listBrowseTournaments(db: Db): Promise<BrowseTournament[]> {
  const [active, finished] = await Promise.all([
    db.select(columns).from(tournaments).where(notInArray(tournaments.status, ["draft", "cancelled", "finished"])),
    db
      .select(columns)
      .from(tournaments)
      .where(eq(tournaments.status, "finished"))
      .orderBy(desc(tournaments.startsAt))
      .limit(FINISHED_LIMIT),
  ]);
  const rows = [...active, ...finished];
  if (rows.length === 0) return [];
  const counts = await db
    .select({ tournamentId: registrations.tournamentId, n: count() })
    .from(registrations)
    .where(and(eq(registrations.status, "confirmed"), inArray(registrations.tournamentId, rows.map((r) => r.id))))
    .groupBy(registrations.tournamentId);
  const confirmed = new Map(counts.map((c) => [c.tournamentId, c.n]));
  return rows.map(({ id, eligibilityRules, ...r }) => ({
    ...r,
    confirmedCount: confirmed.get(id) ?? 0,
    rankBracket: rankBracketOf(eligibilityRules),
  }));
}

export type BrowsePage = {
  filters: BrowseSearch;
  upcoming: BrowseTournament[];
  live: BrowseTournament[];
  finished: BrowseTournament[];
  /** Whether any public tournament exists at all, before filters: tells "nothing matches" from "nothing yet". */
  hasAny: boolean;
};

export async function loadBrowsePage(db: Db, filters: BrowseSearch, now: Date): Promise<BrowsePage> {
  const all = await listBrowseTournaments(db);
  const groups = groupForBrowse(filterTournaments(all, filters, now), now);
  return { filters, ...groups, hasAny: all.length > 0 };
}
