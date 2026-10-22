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
