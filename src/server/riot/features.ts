import { type Env, env } from "../env";

export type RiotFeature = Env["RIOT_FEATURES"][number];
export type RiotFeatures = { rso: boolean; tournamentCodes: boolean; resultCallbacks: boolean };

/** Each Riot-approved capability adds a path next to the fallback; all off is the fallback-only app. */
export function riotFeatures(e: Pick<Env, "RIOT_FEATURES">): RiotFeatures {
  const on = new Set(e.RIOT_FEATURES);
  return { rso: on.has("rso"), tournamentCodes: on.has("tournament_codes"), resultCallbacks: on.has("result_callbacks") };
}

export const features: RiotFeatures = riotFeatures(env);
