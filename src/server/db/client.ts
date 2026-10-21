import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export function createDb(url: string) {
  return drizzle(postgres(url, { onnotice: () => {} }), { schema });
}

export type Db = ReturnType<typeof createDb>;

export const db = createDb(env.DATABASE_URL);

/** A database handle or an open transaction. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Postgres unique violation, possibly wrapped by drizzle; returns the violated constraint's name. */
export function uniqueViolation(error: unknown): string | null {
  for (let e = error as { code?: string; constraint_name?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.code === "23505") return e.constraint_name ?? "";
  }
  return null;
}
