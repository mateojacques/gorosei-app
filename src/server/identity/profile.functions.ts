import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { slugToRiotId } from "../../shared/riot-id";

export const getProfileBySlug = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string() }))
  .handler(async ({ data }) => {
    const riotId = slugToRiotId(data.slug);
    if (!riotId) throw notFound();
    // Server-only modules are imported inside the handler so they never reach the client bundle.
    const [{ db }, { getPublicProfile }] = await Promise.all([import("../db/client"), import("./profile")]);
    const profile = await getPublicProfile(db, riotId.gameName, riotId.tagLine);
    if (!profile) throw notFound();
    return profile;
  });
