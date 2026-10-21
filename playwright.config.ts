import { defineConfig } from "@playwright/test";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/gorosei_test";

// The e2e seed and the dev server both use the test database.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.RIOT_API_KEY ??= "e2e-riot-key";
process.env.BETTER_AUTH_SECRET ??= "8e3f3b1de4b1dc812d780bf47dd31f97c996b328476abbd0bcb45dba04bfe938";
process.env.BETTER_AUTH_URL ??= "http://localhost:3100";

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  use: { baseURL: "http://localhost:3100", javaScriptEnabled: false },
  webServer: {
    command: "bunx vite dev --port 3100",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      RIOT_API_KEY: process.env.RIOT_API_KEY,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    },
  },
});
