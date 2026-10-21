process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/gorosei_test";
process.env.RIOT_API_KEY ??= "test-riot-key";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-00";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
