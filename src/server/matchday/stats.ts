import { and, eq, inArray } from "drizzle-orm";
import { RIOT_MATCH_ID, type UserRole, isModerator } from "../../shared/match";
import { formatRiotId } from "../../shared/riot-id";
import { writeAudit } from "../audit";
import type { Db } from "../db/client";
import { matches, registrationPlayers, riotAccounts, teams, registrations } from "../db/schema";
import { announceMatch } from "./events";
import type { RiotClient, RiotMatch } from "../riot/types";

export type StatsRejection = "not_found" | "forbidden" | "invalid_id" | "riot_unavailable" | "not_this_match";

export type MatchStats = RiotMatch & { players: (RiotMatch["players"][number] & { riotId: string | null })[] };

const MAX_MATCH_IDS = 3;
const MIN_PER_ROSTER = 3;

export async function attachRiotMatchIds(
  deps: { db: Db; riot: RiotClient },
  user: { id: string; role: UserRole },
  matchId: string,
  riotMatchIds: string[],
): Promise<{ ok: true } | { ok: false; reason: StatsRejection }> {
  const { db, riot } = deps;
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

  const wanted = [...new Set(riotMatchIds)];
  if (wanted.length === 0 || wanted.length > MAX_MATCH_IDS || !wanted.every((id) => RIOT_MATCH_ID.test(id))) {
    return { ok: false, reason: "invalid_id" };
  }
  const fresh = wanted.filter((id) => !match.riotMatchIds.includes(id));
  if (fresh.length === 0) return { ok: true };
  if (match.riotMatchIds.length + fresh.length > MAX_MATCH_IDS) return { ok: false, reason: "invalid_id" };

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

  const stats = [...((match.stats as MatchStats[] | null) ?? []), ...fetched];
  await db.transaction(async (tx) => {
    await tx
      .update(matches)
      .set({ stats, riotMatchIds: [...match.riotMatchIds, ...fresh] })
      .where(eq(matches.id, matchId));
    await writeAudit(tx, {
      actorUserId: user.id,
      action: "match.stats_attached",
      entityType: "match",
      entityId: matchId,
      data: { tournamentId: match.tournamentId, riotMatchIds: fresh },
    });
  });
  void announceMatch(db, matchId);
  return { ok: true };
}
