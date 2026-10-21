import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "./db/client";
import * as schema from "./db/schema";
import { env } from "./env";

export const ROLES = ["player", "moderator", "admin"] as const;
export type Role = (typeof ROLES)[number];

const discord =
  env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
    ? { discord: { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET } }
    : {};

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true },
  socialProviders: discord,
  user: {
    additionalFields: {
      role: { type: [...ROLES], required: false, defaultValue: "player", input: false },
    },
  },
  plugins: [tanstackStartCookies()],
});

export const isDiscordEnabled = "discord" in discord;

export type SessionUser = { id: string; role: Role; name: string };

export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const { id, name, role } = session.user;
  return { id, name, role: role as Role };
}

export async function requireRole(headers: Headers, role: Role): Promise<SessionUser> {
  const sessionUser = await getSessionUser(headers);
  if (!sessionUser) throw new Response("Unauthorized", { status: 401 });
  if (ROLES.indexOf(sessionUser.role) < ROLES.indexOf(role)) {
    throw new Response("Forbidden", { status: 403 });
  }
  return sessionUser;
}
