import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { FormAlert } from "../components/site/form";
import { InboxList } from "../components/site/inbox-list";
import { getInboxFn, markAllReadFn, setEmailEnabledFn } from "../server/notifications/notifications.functions";
import { t } from "../shared/i18n";
import { NOINDEX_META } from "../shared/seo";

export const Route = createFileRoute("/notificaciones")({
  loader: () => getInboxFn(),
  head: () => ({ meta: [{ title: `${t("inbox.title")} · ${t("app.name")}` }, NOINDEX_META] }),
  component: InboxPage,
});

function InboxPage() {
  const { items, emailEnabled } = Route.useLoaderData();
  const newest = items[0];
  const hasUnread = items.some((item) => !item.read);

  // Opening the inbox marks what it shows as read; anything newer stays unread.
  useEffect(() => {
    if (newest && hasUnread) void markAllReadFn({ data: { upTo: new Date(newest.createdAt).toISOString() } }).catch(() => {});
  }, [newest, hasUnread]);

  return (
    <main className="px-4 py-12 sm:px-8 md:py-20">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-[clamp(2.5rem,12vw,4rem)] leading-[0.9] font-black uppercase">{t("inbox.title")}</h1>
        <EmailSwitch initial={emailEnabled} />
        <InboxList items={items} />
      </div>
    </main>
  );
}

function EmailSwitch({ initial }: { initial: boolean }) {
  const id = useId();
  const [enabled, setEnabled] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function toggle(next: boolean) {
    setPending(true);
    setError(false);
    setEnabled(next);
    try {
      await setEmailEnabledFn({ data: { enabled: next } });
    } catch {
      setEnabled(!next);
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <label htmlFor={id} className="flex items-start gap-3">
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 size-5 accent-cobalt-light"
          checked={enabled}
          disabled={pending}
          onChange={(e) => void toggle(e.target.checked)}
          aria-describedby={`${id}-hint`}
        />
        <span>
          <span className="font-semibold">{t("inbox.email")}</span>
          <span id={`${id}-hint`} className="block text-sm text-ink-muted">
            {t("inbox.emailHint")}
          </span>
        </span>
      </label>
      {error && <FormAlert>{t("common.error")}</FormAlert>}
    </div>
  );
}
