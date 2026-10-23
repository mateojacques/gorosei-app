import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { writeAudit } from "../audit";
import type { Db } from "../db/client";
import { appSettings, matchMessages, matches, tournaments } from "../db/schema";
import type { RiotTournamentClient } from "../riot/tournament-client";
import { announceMatch } from "./events";
import { lockMatch } from "./reports";

const PROVIDER_KEY = "riot_tournament_provider";

/** Where Riot posts game results; without a secret (callbacks off) a path that answers 404. */
export function riotCallbackUrl(origin: string, secret: string | undefined): string {
  return `${origin}/api/riot/callback/${secret ?? "off"}`;
}

type Deps = { db: Db; client: RiotTournamentClient; callbackUrl: string };

/**
 * Requests one Riot tournament code per open match of a live tournament that has both teams and no lobby yet.
 * A match whose code can't be issued stays open, so a moderator can still post a lobby; a lobby posted while
 * the code was requested wins and the code is dropped.
 */
export async function issueTournamentCodes(deps: Deps, _now: Date): Promise<{ issued: number; failed: number }> {
  const { db } = deps;
  const due = await db
    .select({ match: matches, tournament: tournaments })
    .from(matches)
    .innerJoin(tournaments, eq(tournaments.id, matches.tournamentId))
    .where(
      and(
        eq(tournaments.status, "live"),
        eq(matches.status, "open"),
        isNotNull(matches.reg1Id),
        isNotNull(matches.reg2Id),
        isNull(matches.lobbyName),
        isNull(matches.tournamentCode),
      ),
    );
  let issued = 0;
  let failed = 0;
  let providerId: number | null = null;
  for (const { match, tournament } of due) {
    try {
      providerId ??= await ensureProvider(deps);
      const riotTournamentId = providerId === null ? null : await ensureRiotTournament(deps, providerId, tournament);
      if (riotTournamentId === null) {
        failed++;
        continue;
      }
      const codes = await deps.client.createCodes(riotTournamentId, 1, {
        pickType: tournament.draftMode === "blind_pick" ? "BLIND_PICK" : "TOURNAMENT_DRAFT",
        metadata: match.id,
      });
      const code = codes.ok ? codes.data[0] : undefined;
      if (!code) {
        failed++;
        continue;
      }
      if (await storeCode(db, match.id, code)) {
        issued++;
        await announceMatch(db, match.id);
      }
    } catch (error) {
      failed++;
      console.error(`[jobs] issue-tournament-codes: match ${match.id} failed`, error);
    }
  }
  return { issued, failed };
}

/** The provider is registered once per callback URL and cached in app settings. */
async function ensureProvider({ db, client, callbackUrl }: Deps): Promise<number | null> {
  const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, PROVIDER_KEY));
  const cached = row?.value as { url: string; id: number } | undefined;
  if (cached?.url === callbackUrl) return cached.id;
  const registered = await client.registerProvider(callbackUrl);
  if (!registered.ok) return null;
  const value = { url: callbackUrl, id: registered.data };
  await db.insert(appSettings).values({ key: PROVIDER_KEY, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
  return registered.data;
}

async function ensureRiotTournament(
  { db, client }: Deps,
  providerId: number,
  tournament: typeof tournaments.$inferSelect,
): Promise<number | null> {
  const [current] = await db.select({ id: tournaments.riotTournamentId }).from(tournaments).where(eq(tournaments.id, tournament.id));
  if (current?.id != null) return current.id;
  const created = await client.createTournament(providerId, `${tournament.title} #${tournament.edition}`);
  if (!created.ok) return null;
  await db.update(tournaments).set({ riotTournamentId: created.data }).where(eq(tournaments.id, tournament.id));
  return created.data;
}

async function storeCode(db: Db, matchId: string, code: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const match = await lockMatch(tx, matchId);
    if (!match || match.status !== "open" || match.lobbyName !== null || match.tournamentCode !== null) return false;
    await tx.update(matches).set({ tournamentCode: code, status: "in_progress" }).where(eq(matches.id, matchId));
    await tx.insert(matchMessages).values({ matchId, authorUserId: null, kind: "lobby", body: code });
    await writeAudit(tx, {
      actorUserId: null,
      action: "match.code_issued",
      entityType: "match",
      entityId: matchId,
      data: { tournamentId: match.tournamentId, code },
    });
    return true;
  });
}
