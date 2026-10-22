import { Link, useLocation } from "@tanstack/react-router";
import { useRealtime } from "@/components/matchday/use-realtime";
import { buttonVariants } from "@/components/ui/button";
import { t } from "@/shared/i18n";

/** "Avisos" plus the unread count; a notification for this user reloads the page data, which carries the new count. */
export function InboxLink({ userId, unread }: { userId: string; unread: number }) {
  useRealtime([`user:${userId}`], undefined, { siteWide: true });
  // The inbox page marks everything read as it opens.
  const count = useLocation({ select: (l) => l.pathname }) === "/notificaciones" ? 0 : unread;
  return (
    <Link
      to="/notificaciones"
      className={buttonVariants({ variant: "ghost", size: "sm", className: "gap-1.5 px-2" })}
      aria-label={count > 0 ? t("inbox.linkUnread", { count }) : undefined}
    >
      {t("inbox.link")}
      {count > 0 && (
        <span aria-hidden className="min-w-5 bg-cobalt px-1 text-center text-xs leading-5 font-bold text-ink tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
