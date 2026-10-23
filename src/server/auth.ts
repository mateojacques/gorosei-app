import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { db } from "./db/client";
import * as schema from "./db/schema";
import { env } from "./env";
import { RSO_PROVIDER_ID, linkRsoAccount, rsoLinkAllowed, rsoUserInfo } from "./identity/rso";
import { riot } from "./riot";
import { features } from "./riot/features";

export const ROLES = ["player", "moderator", "admin"] as const;
export type Role = (typeof ROLES)[number];

// With Riot Sign On, new accounts come only from Riot; existing email and Discord accounts can still sign in.
const signUpClosed = features.rso;

const discord =
  env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET
    ? {
        discord: {
          clientId: env.DISCORD_CLIENT_ID,
          clientSecret: env.DISCORD_CLIENT_SECRET,
          ...(signUpClosed ? { disableSignUp: true } : {}),
        },
      }
    : {};

/** Riot Sign On, only when the `rso` capability is on; otherwise none of this is configured. */
const rso = features.rso
  ? {
      plugins: [
        genericOAuth({
          config: [
            {
              providerId: RSO_PROVIDER_ID,
              name: "Riot",
              clientId: env.RIOT_RSO_CLIENT_ID!,
              clientSecret: env.RIOT_RSO_CLIENT_SECRET!,
              authorizationUrl: "https://auth.riotgames.com/authorize",
              tokenUrl: "https://auth.riotgames.com/token",
              scopes: ["openid", "offline_access", "cpid"],
              getUserInfo: (tokens) => (tokens.accessToken ? rsoUserInfo({ db, riot }, tokens.accessToken) : Promise.resolve(null)),
            },
          ],
        }),
      ],
      options: {
        // A Riot account already verified by icon change lands in that account (rsoUserInfo answers with its email);
        // linking from a signed-in account has a placeholder email that never matches, so different emails are allowed.
        account: { accountLinking: { enabled: true, trustedProviders: [RSO_PROVIDER_ID], allowDifferentEmails: true } },
        databaseHooks: {
          account: {
            create: {
              before: async (account: { providerId: string; accountId: string; userId: string }) => {
                // One Riot account per platform account and vice versa.
                if (account.providerId === RSO_PROVIDER_ID && !(await rsoLinkAllowed(db, account.userId, account.accountId))) {
                  return false;
                }
              },
              after: async (account: { providerId: string; accountId: string; userId: string }) => {
                if (account.providerId !== RSO_PROVIDER_ID) return;
                const linked = await linkRsoAccount({ db, riot }, account.userId, account.accountId).catch((error) => {
                  console.error("[auth] linking the Riot account failed", error);
                  return null;
                });
                if (linked && !linked.ok) console.error(`[auth] linking the Riot account failed: ${linked.reason}`);
              },
            },
          },
        },
      },
    }
  : null;

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: { enabled: true, ...(signUpClosed ? { disableSignUp: true } : {}) },
  socialProviders: discord,
  user: {
    additionalFields: {
      role: { type: [...ROLES], required: false, defaultValue: "player", input: false },
    },
  },
  ...(rso?.options ?? {}),
  // tanstackStartCookies stays last.
  plugins: [...(rso?.plugins ?? []), tanstackStartCookies()],
});

export const isDiscordEnabled = "discord" in discord;
export const isRsoEnabled = features.rso;

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
