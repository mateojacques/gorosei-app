import { redirect } from "@tanstack/react-router";
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";

// Server-only modules are imported inside handlers so they never reach the client bundle.
const requireUser = createServerOnlyFn(async () => {
  const { getSessionUser } = await import("../auth");
  const user = await getSessionUser(getRequestHeaders());
  if (!user) throw redirect({ to: "/ingresar" });
  return user;
});

async function deps() {
  const [{ db }, inbox, settings] = await Promise.all([import("../db/client"), import("./inbox"), import("./settings")]);
  return { db, inbox, settings };
}

export const getInboxFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const { db, inbox, settings } = await deps();
  const [items, emailEnabled] = await Promise.all([inbox.listNotifications(db, user.id), settings.getEmailEnabled(db, user.id)]);
  return { items, emailEnabled };
});

/** Marks the signed-in user's own notifications read, up to the newest one their page showed. */
export const markAllReadFn = createServerFn({ method: "POST" })
  .validator(z.object({ upTo: z.iso.datetime() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, inbox } = await deps();
    await inbox.markAllRead(db, user.id, new Date(data.upTo));
    return { ok: true as const };
  });

export const setEmailEnabledFn = createServerFn({ method: "POST" })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    const { db, settings } = await deps();
    await settings.setEmailEnabled(db, user.id, data.enabled);
    return { ok: true as const };
  });
