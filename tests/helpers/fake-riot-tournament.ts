import type { PickType, RiotTournamentClient } from "../../src/server/riot/tournament-client";
import type { RiotResult } from "../../src/server/riot/types";

type Call =
  | { method: "registerProvider"; url: string }
  | { method: "createTournament"; providerId: number; name: string }
  | { method: "createCodes"; tournamentId: number; count: number; pickType: PickType; metadata: string };

const unavailable = { ok: false, error: "unavailable" } as const;

/** Records calls; hands out providers 1, 2…, tournaments 101, 102… and codes "LA2-CODE-1", "LA2-CODE-2"… */
export class FakeRiotTournamentClient implements RiotTournamentClient {
  readonly calls: Call[] = [];
  failing = false;
  /** Runs before a code is returned, e.g. to race a moderator posting a lobby. */
  beforeCode?: (metadata: string) => Promise<void>;
  private providers = 0;
  private tournaments = 100;
  private codes = 0;

  async registerProvider(url: string): Promise<RiotResult<number>> {
    this.calls.push({ method: "registerProvider", url });
    return this.failing ? unavailable : { ok: true, data: ++this.providers };
  }

  async createTournament(providerId: number, name: string): Promise<RiotResult<number>> {
    this.calls.push({ method: "createTournament", providerId, name });
    return this.failing ? unavailable : { ok: true, data: ++this.tournaments };
  }

  async createCodes(tournamentId: number, count: number, opts: { pickType: PickType; metadata: string }): Promise<RiotResult<string[]>> {
    this.calls.push({ method: "createCodes", tournamentId, count, ...opts });
    if (this.failing) return unavailable;
    await this.beforeCode?.(opts.metadata);
    return { ok: true, data: Array.from({ length: count }, () => `LA2-CODE-${++this.codes}`) };
  }
}
