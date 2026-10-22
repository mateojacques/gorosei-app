import { desc, eq, isNull, max, ne, sql } from "drizzle-orm";
import { PRIVACY_LAST_UPDATED } from "../../shared/privacy";
import { riotIdToSlug } from "../../shared/riot-id";
import { MAX_SITEMAP_URLS } from "../../shared/seo";
import type { SitemapEntry } from "../../shared/seo";
import type { Db } from "../db/client";
import { registrations, riotAccounts, teams, tournaments } from "../db/schema";

/** Every public, indexable page. Match pages carry noindex and are not listed. */
export async function listSitemapEntries(db: Db): Promise<SitemapEntry[]> {
  const [publicTournaments, keptTeams, players] = await Promise.all([
    db
      .select({ slug: tournaments.slug, updatedAt: tournaments.updatedAt })
      .from(tournaments)
      .where(ne(tournaments.status, "draft"))
      .orderBy(desc(tournaments.updatedAt))
      .limit(MAX_SITEMAP_URLS),
    db
      .select({ slug: teams.slug, createdAt: teams.createdAt, lastRegistration: max(registrations.updatedAt) })
      .from(teams)
      .leftJoin(registrations, eq(registrations.teamId, teams.id))
      .where(isNull(teams.autoFormedTournamentId))
      .groupBy(teams.id)
      .limit(MAX_SITEMAP_URLS),
    db
      .select({
        gameName: riotAccounts.gameName,
        tagLine: riotAccounts.tagLine,
        lastmod: sql<Date>`greatest(${riotAccounts.linkedAt}, coalesce(${riotAccounts.lastPolledAt}, ${riotAccounts.linkedAt}))`.mapWith(
          (v: string | Date) => new Date(v),
        ),
      })
      .from(riotAccounts)
      .limit(MAX_SITEMAP_URLS),
  ]);
  const latestTournament = publicTournaments[0]?.updatedAt ?? PRIVACY_LAST_UPDATED;
  const entries: SitemapEntry[] = [
    { path: "/", lastmod: latestTournament },
    { path: "/torneos", lastmod: latestTournament },
    { path: "/privacidad", lastmod: PRIVACY_LAST_UPDATED },
    ...publicTournaments.map((t) => ({ path: `/torneos/${t.slug}`, lastmod: t.updatedAt })),
    ...keptTeams.map((t) => {
      const last = t.lastRegistration ? new Date(t.lastRegistration) : null;
      return { path: `/equipos/${t.slug}`, lastmod: last && last > t.createdAt ? last : t.createdAt };
    }),
    ...players.map((p) => ({ path: `/jugador/${riotIdToSlug(p)}`, lastmod: p.lastmod })),
  ];
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.path) ? false : (seen.add(e.path), true)));
}
