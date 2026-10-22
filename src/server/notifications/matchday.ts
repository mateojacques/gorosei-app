import { eq } from "drizzle-orm";
import type { Executor } from "../db/client";
import { matches } from "../db/schema";
import { notify } from "./notify";
import { captainOf, rosterUserIds, teamNameOf, tournamentRef } from "./recipients";

type MatchRow = typeof matches.$inferSelect;

/** Tells both rosters their match is open. Keyed by when it opened, so a reset match is announced again. */
export async function notifyMatchReady(tx: Executor, match: Pick<MatchRow, "id" | "tournamentId" | "reg1Id" | "reg2Id" | "openedAt">) {
  if (!match.reg1Id || !match.reg2Id || !match.openedAt) return;
  const tournament = await tournamentRef(tx, match.tournamentId);
  const key = `match_ready:${match.id}:${match.openedAt.toISOString()}`;
  for (const [own, other] of [
    [match.reg1Id, match.reg2Id],
    [match.reg2Id, match.reg1Id],
  ] as const) {
    await notify(
      tx,
      await rosterUserIds(tx, own),
      { kind: "match_ready", tournament, matchId: match.id, opponent: await teamNameOf(tx, other) },
      key,
    );
  }
}

/** Tells both rosters the confirmed result from their own side. Reads the match after the bracket was saved. */
export async function notifyResult(tx: Executor, matchId: string) {
  const [match] = await tx.select().from(matches).where(eq(matches.id, matchId));
  if (!match?.reg1Id || !match.reg2Id || !match.confirmedAt) return;
  const tournament = await tournamentRef(tx, match.tournamentId);
  const key = `result:${match.id}:${match.confirmedAt.toISOString()}`;
  for (const [own, side] of [
    [match.reg1Id, 1],
    [match.reg2Id, 2],
  ] as const) {
    const won = match.winnerRegId === own;
    // A forfeit carries no game score; show it as one game to none.
    const score: [number, number] =
      match.score1 === null || match.score2 === null
        ? won
          ? [1, 0]
          : [0, 1]
        : side === 1
          ? [match.score1, match.score2]
          : [match.score2, match.score1];
    await notify(tx, await rosterUserIds(tx, own), { kind: "result_confirmed", tournament, matchId, won, score }, key);
  }
}

export async function notifyDisputed(tx: Executor, match: Pick<MatchRow, "id" | "tournamentId" | "reg1Id" | "reg2Id" | "openedAt">) {
  const captains = [];
  for (const registrationId of [match.reg1Id, match.reg2Id]) {
    const captain = registrationId ? await captainOf(tx, registrationId) : null;
    if (captain) captains.push(captain);
  }
  await notify(
    tx,
    captains,
    { kind: "match_disputed", tournament: await tournamentRef(tx, match.tournamentId), matchId: match.id },
    `disputed:${match.id}:${match.openedAt?.toISOString() ?? ""}`,
  );
}
