import { formatCupDay, formatCupTime } from "@/shared/format";
import { t } from "@/shared/i18n";
import type { ScheduleRow } from "@/shared/stage";

/** The cup's timeline in ART: registration close, the check-in window, the start. */
export function Schedule({ rows }: { rows: ScheduleRow[] }) {
  return (
    <section aria-labelledby="schedule-h">
      <h2 id="schedule-h" className="font-display text-2xl font-extrabold uppercase">
        {t("schedule.title")}
      </h2>
      <ol className="mt-3 border-b border-line">
        {rows.map((row) => {
          const at = new Date(row.at);
          return (
            <li key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-4 border-t border-line py-2.5">
              <span>{t(`schedule.${row.key}`)}</span>
              <time dateTime={at.toISOString()} className="font-display text-lg font-extrabold tracking-[0.02em] uppercase tabular-nums">
                {formatCupDay(at)} · {formatCupTime(at)} {t("cup.timeZone")}
              </time>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
