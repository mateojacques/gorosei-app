import { type RiotHttpOptions, riotRequest } from "./http";
import type { RiotResult } from "./types";

const REGIONAL_HOST = "https://americas.api.riotgames.com";

export type PickType = "TOURNAMENT_DRAFT" | "BLIND_PICK";

export interface RiotTournamentClient {
  registerProvider(callbackUrl: string): Promise<RiotResult<number>>;
  createTournament(providerId: number, name: string): Promise<RiotResult<number>>;
  createCodes(tournamentId: number, count: number, opts: { pickType: PickType; metadata: string }): Promise<RiotResult<string[]>>;
}

/** tournament-v5 (or its stub, for development keys) on the Americas regional host. */
export function createRiotTournamentClient(opts: RiotHttpOptions & { apiKey: string; stub: boolean }): RiotTournamentClient {
  const base = `${REGIONAL_HOST}/lol/${opts.stub ? "tournament-stub" : "tournament"}/v5`;
  const post = <T>(path: string, body: unknown) =>
    riotRequest<T>(opts, "POST", `${base}${path}`, { headers: { "X-Riot-Token": opts.apiKey }, body });
  return {
    registerProvider: (url) => post<number>("/providers", { region: "LAS", url }),
    createTournament: (providerId, name) => post<number>("/tournaments", { name, providerId }),
    createCodes: (tournamentId, count, { pickType, metadata }) =>
      post<string[]>(`/codes?tournamentId=${tournamentId}&count=${count}`, {
        mapType: "SUMMONERS_RIFT",
        pickType,
        spectatorType: "ALL",
        teamSize: 5,
        metadata,
        // No allowedParticipants: the code is private to the two teams and results are checked against the rosters.
        enoughPlayers: false,
      }),
  };
}
