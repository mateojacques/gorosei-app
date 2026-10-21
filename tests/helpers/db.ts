import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "../../src/server/db/client";
import * as schema from "../../src/server/db/schema";

// tests/setup.ts points DATABASE_URL at the test database, so `db` is the test DB.
export const testDb = db;

const tableNames = (Object.values(schema) as unknown[])
  .filter((value): value is PgTable => is(value, PgTable))
  .map((table) => `"${getTableName(table)}"`);

const migrated = migrate(testDb, { migrationsFolder: "drizzle" });

export async function resetTestDb(): Promise<void> {
  await migrated;
  await testDb.execute(sql.raw(`TRUNCATE ${tableNames.join(", ")} RESTART IDENTITY CASCADE`));
}

export async function createTestUser(id: string): Promise<string> {
  await testDb.insert(schema.user).values({ id, name: id, email: `${id}@test.local` });
  return id;
}
