import { and, eq, inArray } from "drizzle-orm";
import { RIOT_MATCH_ID, type UserRole, isModerator, validateScore } from "../../shared/match";
import { formatRiotId } from "../../shared/riot-id";
import { writeAudit } from "../audit";
import type { Db } from "../db/client";
import { matches, registrationPlayers, riotAccounts, teams, registrations } from "../db/schema";
import { announceMatch } from "./events";
import { lockMatch } from "./reports";
import type { RiotClient, RiotMatch } from "../riot/types";

export type StatsRejection = "not_found" | "forbidden" | "invalid_id" | "riot_unavailable" | "not_this_match";

export type MatchStats = Omit<RiotMatch, "players"> & { players: (RiotMatch["players"][number] & { riotId: string | null })[] };
/** Stats as pages show them: no PUUIDs, players by Riot ID. */
export type PublicMatchStats = Omit<MatchStats, "players"> & { players: Omit<MatchStats["players"][number], "puuid">[] };

const MAX_MATCH_IDS = 3;
const MIN_PER_ROSTER = 3;

/** A captain of either team or a moderator attaches Riot match IDs (fallback mode: stats only, no score). */
export async function attachRiotMatchIds(
  deps: { db: Db; riot: RiotClient },
  user: { id: string; role: UserRole },
  matchId: string,
  riotMatchIds: string[],
): Promise<{ ok: true } | { ok: false; reason: StatsRejection }> {
  const { db } = deps;
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return { ok: false, reason: "not_found" };

  const regIds = [match.reg1Id, match.reg2Id].filter((id): id is string => id !== null);
  const captains = regIds.length
    ? await db
        .select({ captainUserId: teams.captainUserId })
        .from(registrations)
        .innerJoin(teams, eq(teams.id, registrations.teamId))
        .where(inArray(registrations.id, regIds))
    : [];
  if (!isModerator(user.role) && !captains.some((c) => c.captainUserId === user.id)) return { ok: false, reason: "forbidden" };
  return attachVerifiedRiotMatchIds(deps, user.id, matchId, riotMatchIds, { score: false });
}

/**
 * Stores Riot match data for games the two rosters played (at least 3 players of each). For system callers
 * (Riot result callbacks) it also recomputes `riot_score` from every stored game and, when that score decides
 * the match, marks an open or in-progress match reported for a moderator to confirm.
 */
export async function attachVerifiedRiotMatchIds(
  deps: { db: Db; riot: RiotClient },
  actorUserId: string | null,
  matchId: string,
  riotMatchIds: string[],
  opts: { score: boolean } = { score: true },
): Promise<{ ok: true } | { ok: false; reason: Exclude<StatsRejection, "forbidden"> }> {
  const { db, riot } = deps;
  const [match] = await db.select().from(matches).where(eq(matches.id, matchId));
  if (!match) return { ok: false, reason: "not_found" };
  // A Bo5 can need five games.
  const maxIds = Math.max(MAX_MATCH_IDS, match.bestOf);

  const wanted = [...new Set(riotMatchIds)];
  if (wanted.length === 0 || wanted.length > maxIds || !wanted.every((id) => RIOT_MATCH_ID.test(id))) {
    return { ok: false, reason: "invalid_id" };
  }
  const fresh = wanted.filter((id) => !match.riotMatchIds.includes(id));
  if (fresh.length === 0 && !opts.score) return { ok: true };
  if (match.riotMatchIds.length + fresh.length > maxIds) return { ok: false, reason: "invalid_id" };

  const roster = async (registrationId: string | null) => {
    if (!registrationId) return new Map<string, string>();
    const rows = await db
      .select({ puuid: riotAccounts.puuid, gameName: riotAccounts.gameName, tagLine: riotAccounts.tagLine })
      .from(registrationPlayers)
      .innerJoin(riotAccounts, eq(riotAccounts.id, registrationPlayers.riotAccountId))
      .where(and(eq(registrationPlayers.registrationId, registrationId), eq(registrationPlayers.active, true)));
    return new Map(rows.map((r) => [r.puuid, formatRiotId(r)]));
  };
  const [roster1, roster2] = await Promise.all([roster(match.reg1Id), roster(match.reg2Id)]);

  const fetched: MatchStats[] = [];
  for (const id of fresh) {
    const result = await riot.getMatch(id);
    if (!result.ok) return { ok: false, reason: result.error === "not_found" ? "invalid_id" : "riot_unavailable" };
    const players = result.data.players;
    const from1 = players.filter((p) => roster1.has(p.puuid)).length;
    const from2 = players.filter((p) => roster2.has(p.puuid)).length;
    if (from1 < MIN_PER_ROSTER || from2 < MIN_PER_ROSTER) return { ok: false, reason: "not_this_match" };
    fetched.push({
      ...result.data,
      players: players.map((p) => ({ ...p, riotId: roster1.get(p.puuid) ?? roster2.get(p.puuid) ?? null })),
    });
  }

  await db.transaction(async (tx) => {
    // Locked so two games arriving at once both land.
    const locked = (await lockMatch(tx, matchId))!;
    const added = fetched.filter((f) => !locked.riotMatchIds.includes(f.matchId));
    const stats = [...((locked.stats as MatchStats[] | null) ?? []), ...added];
    const riotMatchIds = [...locked.riotMatchIds, ...added.map((f) => f.matchId)];
    let scoring: Partial<typeof matches.$inferInsert> = {};
    if (opts.score) {
      const riotScore = scoreFromGames(stats, roster1, roster2);
      const decided = validateScore(match.bestOf, riotScore.score1, riotScore.score2);
      scoring = { riotScore, ...(decided && (locked.status === "open" || locked.status === "in_progress") ? { status: "reported" } : {}) };
    }
    await tx.update(matches).set({ stats, riotMatchIds, ...scoring }).where(eq(matches.id, matchId));
    if (added.length > 0) {
      await writeAudit(tx, {
        actorUserId,
        action: "match.stats_attached",
        entityType: "match",
        entityId: matchId,
        data: { tournamentId: match.tournamentId, riotMatchIds: added.map((f) => f.matchId), ...scoring },
      });
    }
  });
  void announceMatch(db, matchId);
  return { ok: true };
}

/** Games won per side: a game goes to the roster with at least 3 players on the winning Riot team. */
function scoreFromGames(games: MatchStats[], roster1: Map<string, string>, roster2: Map<string, string>) {
  let score1 = 0;
  let score2 = 0;
  for (const g of games) {
    const winners = g.players.filter((p) => p.teamId === g.winningTeamId);
    if (winners.filter((p) => roster1.has(p.puuid)).length >= MIN_PER_ROSTER) score1++;
    else if (winners.filter((p) => roster2.has(p.puuid)).length >= MIN_PER_ROSTER) score2++;
  }
  return { score1, score2 };
}
