import { useEffect, useState } from "react";
import { formatCountdown, getCountdown } from "@/shared/countdown";
import { formatCupDay, formatCupTime } from "@/shared/format";
import { t } from "@/shared/i18n";
import { CaptionBar } from "./caption-bar";

export function CupCountdown({ startsAt, className }: { startsAt: Date; className?: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const countdown = getCountdown(now, startsAt);
  const remaining = Math.max(0, Math.floor((startsAt.getTime() - now.getTime()) / 1000));

  return (
    <CaptionBar
      className={className}
      block={
        <time dateTime={startsAt.toISOString()}>
          {`${formatCupDay(startsAt)} · ${formatCupTime(startsAt)} ${t("cup.timeZone")}`}
        </time>
      }
    >
      {/* The server renders its own "now"; the client takes over on mount, so a few seconds of drift is expected. */}
      <span data-remaining={remaining} suppressHydrationWarning>
        {countdown ? `${formatCountdown(countdown)} ${t("cup.untilStart")}` : t("cup.live")}
      </span>
    </CaptionBar>
  );
}
