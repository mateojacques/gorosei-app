import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

// Server-only modules are imported inside handlers so they never reach the client bundle.
async function requireUser() {
  const { getSessionUser } = await import("../auth");
  const user = await getSessionUser(getRequestHeaders());
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

async function linkDeps() {
  const [{ db }, { riot }] = await Promise.all([import("../db/client"), import("../riot")]);
  return { db, riot };
}

export const getRiotLinkState = createServerFn({ method: "GET" }).handler(async () => {
  const { getSessionUser } = await import("../auth");
  const user = await getSessionUser(getRequestHeaders());
  if (!user) return { signedIn: false as const };

  const { db } = await linkDeps();
  const { riotAccounts, riotLinkChallenges } = await import("../db/schema");
  const [linked] = await db
    .select({ gameName: riotAccounts.gameName, tagLine: riotAccounts.tagLine })
    .from(riotAccounts)
    .where(eq(riotAccounts.userId, user.id));
  const [challenge] = await db
    .select({ requiredIconId: riotLinkChallenges.requiredIconId, expiresAt: riotLinkChallenges.expiresAt })
    .from(riotLinkChallenges)
    .where(eq(riotLinkChallenges.userId, user.id));
  return { signedIn: true as const, linked: linked ?? null, challenge: challenge ?? null };
});

export const startRiotLinkFn = createServerFn({ method: "POST" })
  .validator(z.object({ riotId: z.string().max(64) }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { startRiotLink } = await import("./link-riot");
    return startRiotLink(await linkDeps(), user.id, data.riotId);
  });

export const confirmRiotLinkFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireUser();
  const { confirmRiotLink } = await import("./link-riot");
  return confirmRiotLink(await linkDeps(), user.id);
});
