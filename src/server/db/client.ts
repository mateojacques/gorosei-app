import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../env";
import * as schema from "./schema";

export function createDb(url: string) {
  return drizzle(postgres(url, { onnotice: () => {} }), { schema });
}

export type Db = ReturnType<typeof createDb>;

export const db = createDb(env.DATABASE_URL);
