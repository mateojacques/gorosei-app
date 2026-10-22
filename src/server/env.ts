import { z } from "zod";

export const RIOT_FEATURE_NAMES = ["rso", "tournament_codes", "result_callbacks"] as const;

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),
    TEST_DATABASE_URL: z.string().min(1).optional(),
    RIOT_API_KEY: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().url(),
    DISCORD_CLIENT_ID: z.string().min(1).optional(),
    DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
    REALTIME_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    // Without a Resend key, notification emails are only logged.
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(1).optional(),
    // Riot-approved capabilities, each switched on alone: "rso,tournament_codes,result_callbacks". Empty = none.
    RIOT_FEATURES: z
      .string()
      .optional()
      .transform((v) => (v ?? "").split(",").map((f) => f.trim()).filter(Boolean))
      .pipe(z.array(z.enum(RIOT_FEATURE_NAMES))),
    RIOT_RSO_CLIENT_ID: z.string().min(1).optional(),
    RIOT_RSO_CLIENT_SECRET: z.string().min(1).optional(),
    RIOT_TOURNAMENT_STUB: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
    RIOT_CALLBACK_SECRET: z.string().min(32).optional(),
  })
  .superRefine((e, ctx) => {
    const missing = (key: string, message: string) => ctx.addIssue({ code: "custom", path: [key], message });
    if (e.RESEND_API_KEY && !e.EMAIL_FROM) missing("EMAIL_FROM", "required with RESEND_API_KEY");
    const on = new Set(e.RIOT_FEATURES);
    if (on.has("rso") && !e.RIOT_RSO_CLIENT_ID) missing("RIOT_RSO_CLIENT_ID", "required with rso");
    if (on.has("rso") && !e.RIOT_RSO_CLIENT_SECRET) missing("RIOT_RSO_CLIENT_SECRET", "required with rso");
    if (on.has("result_callbacks") && !on.has("tournament_codes")) missing("RIOT_FEATURES", "result_callbacks needs tournament_codes");
    if (on.has("result_callbacks") && !e.RIOT_CALLBACK_SECRET) missing("RIOT_CALLBACK_SECRET", "required with result_callbacks");
  });

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  const nonEmpty = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== ""));
  const result = envSchema.safeParse(nonEmpty);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
    throw new Error(`Invalid or missing environment variables: ${keys.join(", ")}`);
  }
  return result.data;
}

export const env = parseEnv(process.env);
