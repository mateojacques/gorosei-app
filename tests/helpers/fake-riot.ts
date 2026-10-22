import type { RiotClient, RiotMatch, RiotResult, RiotSoloRank } from "../../src/server/riot/types";

type FakeAccount = {
  puuid: string;
  gameName: string;
  tagLine: string;
  profileIconId: number;
  summonerLevel: number;
  rank: RiotSoloRank | null;
};

const unavailable = { ok: false, error: "unavailable" } as const;
const notFound = { ok: false, error: "not_found" } as const;

export class FakeRiotClient implements RiotClient {
  private accounts = new Map<string, FakeAccount>();
  private unavailablePuuids = new Set<string>();
  private matchesById = new Map<string, RiotMatch>();
  private accessTokens = new Map<string, string>();
  readonly matchCalls: string[] = [];

  addMatch(match: RiotMatch): this {
    this.matchesById.set(match.matchId, match);
    return this;
  }

  addAccount(account: Partial<FakeAccount> & Pick<FakeAccount, "puuid" | "gameName" | "tagLine">): this {
    this.accounts.set(account.puuid, { profileIconId: 0, summonerLevel: 30, rank: null, ...account });
    return this;
  }

  /** An RSO access token that resolves to the account (which must also be added). */
  addAccessToken(token: string, account: Partial<FakeAccount> & Pick<FakeAccount, "puuid" | "gameName" | "tagLine">): this {
    if (!this.accounts.has(account.puuid)) this.addAccount(account);
    this.accessTokens.set(token, account.puuid);
    return this;
  }

  setIcon(puuid: string, profileIconId: number) {
    this.get(puuid).profileIconId = profileIconId;
  }

  setRank(puuid: string, rank: RiotSoloRank | null) {
    this.get(puuid).rank = rank;
  }

  rename(puuid: string, gameName: string, tagLine: string) {
    Object.assign(this.get(puuid), { gameName, tagLine });
  }

  setUnavailable(puuid: string, isUnavailable = true) {
    if (isUnavailable) this.unavailablePuuids.add(puuid);
    else this.unavailablePuuids.delete(puuid);
  }

  async getAccountByRiotId(gameName: string, tagLine: string) {
    const match = [...this.accounts.values()].find(
      (a) =>
        a.gameName.toLowerCase() === gameName.toLowerCase() && a.tagLine.toLowerCase() === tagLine.toLowerCase(),
    );
    if (!match) return notFound;
    if (this.unavailablePuuids.has(match.puuid)) return unavailable;
    return { ok: true as const, data: { puuid: match.puuid, gameName: match.gameName, tagLine: match.tagLine } };
  }

  async getAccountByPuuid(puuid: string) {
    return this.lookup(puuid, (a) => ({ puuid: a.puuid, gameName: a.gameName, tagLine: a.tagLine }));
  }

  async getAccountByAccessToken(token: string) {
    const puuid = this.accessTokens.get(token);
    if (!puuid) return unavailable;
    return this.getAccountByPuuid(puuid);
  }

  async getSummonerByPuuid(puuid: string) {
    return this.lookup(puuid, (a) => ({ profileIconId: a.profileIconId, summonerLevel: a.summonerLevel }));
  }

  async getSoloRankByPuuid(puuid: string) {
    return this.lookup(puuid, (a) => (a.rank ? { ...a.rank } : null));
  }

  async getMatch(matchId: string): Promise<RiotResult<RiotMatch>> {
    this.matchCalls.push(matchId);
    if (this.unavailablePuuids.has(matchId)) return unavailable;
    const match = this.matchesById.get(matchId);
    return match ? { ok: true, data: match } : notFound;
  }

  private lookup<T>(puuid: string, pick: (a: FakeAccount) => T): RiotResult<T> {
    const account = this.accounts.get(puuid);
    if (!account) return notFound;
    if (this.unavailablePuuids.has(puuid)) return unavailable;
    return { ok: true, data: pick(account) };
  }

  private get(puuid: string): FakeAccount {
    const account = this.accounts.get(puuid);
    if (!account) throw new Error(`FakeRiotClient: unknown puuid ${puuid}`);
    return account;
  }
}
