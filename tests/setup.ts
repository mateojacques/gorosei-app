process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/gorosei_test";
process.env.RIOT_API_KEY ??= "test-riot-key";
process.env.BETTER_AUTH_SECRET ??= "7d7360696a25793d7b4412c9e515908e83edfd4721663b22ca5b4073d330e7ff";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
