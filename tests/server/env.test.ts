import { expect, test } from "bun:test";
import { parseEnv } from "../../src/server/env";

test("parseEnv lists every missing required key", () => {
  expect(() => parseEnv({ BETTER_AUTH_URL: "http://localhost:3000" })).toThrow(
    "DATABASE_URL, RIOT_API_KEY, BETTER_AUTH_SECRET",
  );
});

test("parseEnv treats Discord credentials as optional", () => {
  const env = parseEnv({
    DATABASE_URL: "postgres://x",
    RIOT_API_KEY: "k",
    BETTER_AUTH_SECRET: "s",
    BETTER_AUTH_URL: "http://localhost:3000",
  });
  expect(env.DISCORD_CLIENT_ID).toBeUndefined();
});

test("parseEnv treats empty values as unset", () => {
  const env = parseEnv({
    DATABASE_URL: "postgres://x",
    RIOT_API_KEY: "k",
    BETTER_AUTH_SECRET: "s",
    BETTER_AUTH_URL: "http://localhost:3000",
    DISCORD_CLIENT_ID: "",
    DISCORD_CLIENT_SECRET: "",
  });
  expect(env.DISCORD_CLIENT_ID).toBeUndefined();
});

const base = {
  DATABASE_URL: "postgres://x",
  RIOT_API_KEY: "k",
  BETTER_AUTH_SECRET: "s",
  BETTER_AUTH_URL: "http://localhost:3000",
};

test("email is optional, but a Resend key needs a sender", () => {
  expect(parseEnv(base).RESEND_API_KEY).toBeUndefined();
  expect(() => parseEnv({ ...base, RESEND_API_KEY: "re_123" })).toThrow("EMAIL_FROM");
  expect(parseEnv({ ...base, RESEND_API_KEY: "re_123", EMAIL_FROM: "Gorosei <avisos@gorosei.gg>" }).EMAIL_FROM).toBe(
    "Gorosei <avisos@gorosei.gg>",
  );
});

test("Riot features are off unless listed", async () => {
  const { riotFeatures } = await import("../../src/server/riot/features");
  expect(riotFeatures(parseEnv(base))).toEqual({ rso: false, tournamentCodes: false, resultCallbacks: false });
  expect(riotFeatures(parseEnv({ ...base, RIOT_FEATURES: "" }))).toEqual({ rso: false, tournamentCodes: false, resultCallbacks: false });
  const rso = { RIOT_RSO_CLIENT_ID: "id", RIOT_RSO_CLIENT_SECRET: "secret" };
  expect(riotFeatures(parseEnv({ ...base, ...rso, RIOT_FEATURES: "rso, tournament_codes" }))).toEqual({
    rso: true,
    tournamentCodes: true,
    resultCallbacks: false,
  });
});

test("Riot features need their credentials and prerequisites", () => {
  expect(() => parseEnv({ ...base, RIOT_FEATURES: "rso,teleport" })).toThrow("RIOT_FEATURES");
  expect(() => parseEnv({ ...base, RIOT_FEATURES: "rso", RIOT_RSO_CLIENT_ID: "id" })).toThrow("RIOT_RSO_CLIENT_SECRET");
  const secret = "x".repeat(32);
  expect(() => parseEnv({ ...base, RIOT_FEATURES: "result_callbacks", RIOT_CALLBACK_SECRET: secret })).toThrow("RIOT_FEATURES");
  expect(() => parseEnv({ ...base, RIOT_FEATURES: "tournament_codes,result_callbacks", RIOT_CALLBACK_SECRET: "x".repeat(20) })).toThrow(
    "RIOT_CALLBACK_SECRET",
  );
  expect(() => parseEnv({ ...base, RIOT_FEATURES: "tournament_codes,result_callbacks" })).toThrow("RIOT_CALLBACK_SECRET");
  const ok = parseEnv({ ...base, RIOT_FEATURES: "tournament_codes,result_callbacks", RIOT_CALLBACK_SECRET: secret });
  expect(ok.RIOT_TOURNAMENT_STUB).toBe(false);
  expect(parseEnv({ ...base, RIOT_TOURNAMENT_STUB: "true" }).RIOT_TOURNAMENT_STUB).toBe(true);
});
