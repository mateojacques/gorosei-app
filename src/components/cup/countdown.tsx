import { useEffect, useState } from "react";
import { formatCountdown, getCountdown } from "@/shared/countdown";
import { formatCupDay, formatCupTime } from "@/shared/format";
import { t } from "@/shared/i18n";
import { CaptionBar } from "./caption-bar";

export function CupCountdown({ startsAt, className }: { startsAt: Date; className?: string }) {
  // Null until mount: the server and the first client render show only the date, so hydration matches.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <CaptionBar
      className={className}
      block={
        <time dateTime={startsAt.toISOString()}>
          {`${formatCupDay(startsAt)} · ${formatCupTime(startsAt)} ${t("cup.timeZone")}`}
        </time>
      }
    >
      {now && <Remaining now={now} startsAt={startsAt} />}
    </CaptionBar>
  );
}

function Remaining({ now, startsAt }: { now: Date; startsAt: Date }) {
  const countdown = getCountdown(now, startsAt);
  const remaining = Math.max(0, Math.floor((startsAt.getTime() - now.getTime()) / 1000));
  return (
    <span data-remaining={remaining}>
      {countdown ? `${formatCountdown(countdown)} ${t("cup.untilStart")}` : t("cup.live")}
    </span>
  );
}
