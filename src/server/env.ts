import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().min(1).optional(),
  RIOT_API_KEY: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const nonEmpty = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const result = envSchema.safeParse(nonEmpty);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => i.path.join(".")))];
    throw new Error(`Invalid or missing environment variables: ${keys.join(", ")}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
