import { formatDateTime, t } from "@/shared/i18n";
import { notificationText, type NotificationPayload } from "@/shared/notifications";

export type InboxItem = { id: string; payload: NotificationPayload; href: string; createdAt: Date | string; read: boolean };

/** Newest first. Unread rows carry display weight; there is no colored marker (red means live). */
export function InboxList({ items }: { items: InboxItem[] }) {
  if (items.length === 0) return <p className="mt-8 max-w-prose text-lg text-ink-muted">{t("inbox.empty")}</p>;
  return (
    <ul className="mt-8 flex flex-col border-t border-line">
      {items.map((item) => {
        const { title, body } = notificationText(item.payload);
        return (
          <li key={item.id} className="border-b border-line">
            <a href={item.href} className="group flex flex-col gap-1 py-4 hover:bg-surface-raised focus-visible:bg-surface-raised sm:px-3">
              <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span
                  className={
                    item.read
                      ? "font-semibold [overflow-wrap:anywhere] group-hover:underline"
                      : "font-display text-xl font-extrabold uppercase [overflow-wrap:anywhere] group-hover:underline"
                  }
                >
                  {item.read ? title : <>{title}<span className="sr-only"> · {t("inbox.unread")}</span></>}
                </span>
                <time dateTime={new Date(item.createdAt).toISOString()} className="text-sm text-ink-muted tabular-nums">
                  {formatDateTime(new Date(item.createdAt))}
                </time>
              </span>
              <span className="text-ink-muted [overflow-wrap:anywhere]">{body}</span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
