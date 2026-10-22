import { useId } from "react";
import { formatArs } from "@/shared/format";
import { t } from "@/shared/i18n";

/** Current pool against the goal, the split per place, and the pool-is-the-prize warning beside them. */
export function PrizeMeter({
  poolArs,
  goalArs,
  split,
  prizeShares,
  goalShares,
}: {
  poolArs: number;
  goalArs: number;
  split: number[];
  prizeShares: number[];
  goalShares: number[];
}) {
  const headingId = useId();
  const ratio = goalArs > 0 ? Math.min(1, poolArs / goalArs) : 0;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <h2 id={headingId} className="font-display text-2xl font-extrabold uppercase">
        {t("tournament.prize.title")}
      </h2>
      <div>
        <p className="font-display text-[clamp(2.5rem,12vw,4.5rem)] leading-[0.9] font-black text-cobalt-light">
          {formatArs(goalArs)}
        </p>
        <p className="mt-2 font-semibold">{t("tournament.prize.goal")}</p>
      </div>
      <div>
        <div
          role="meter"
          aria-label={t("tournament.prize.pool")}
          aria-valuemin={0}
          aria-valuemax={goalArs}
          aria-valuenow={poolArs}
          aria-valuetext={t("tournament.prize.progress", { pool: formatArs(poolArs), goal: formatArs(goalArs) })}
          className="h-3 w-full bg-surface-raised"
        >
          <div className="h-full bg-cobalt-light" style={{ width: `${ratio * 100}%` }} />
        </div>
        <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-sm">
          <span>
            <span className="text-ink-muted">{t("tournament.prize.pool")}:</span>{" "}
            <strong className="font-bold">{formatArs(poolArs)}</strong>
          </span>
          <span className="text-ink-muted">{t("tournament.prize.progress", { pool: formatArs(poolArs), goal: formatArs(goalArs) })}</span>
        </p>
      </div>
      <p className="bg-surface-raised px-3 py-2.5 text-sm font-semibold">{t("tournament.poolWarning")}</p>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line font-display text-sm font-extrabold tracking-[0.04em] text-ink-muted uppercase">
            <th scope="col" className="pb-2">
              {t("tournament.prize.place")}
            </th>
            <th scope="col" className="pb-2 text-right">
              {t("tournament.prize.pool")}
            </th>
            <th scope="col" className="pb-2 text-right">
              {t("tournament.prize.goal")}
            </th>
          </tr>
        </thead>
        <tbody>
          {split.map((percent, i) => (
            <tr key={i} className="border-b border-line">
              <th scope="row" className="py-2 font-display text-lg font-extrabold">
                {t("tournament.prize.placeValue", { place: i + 1 })} <span className="text-sm text-ink-muted">{percent}%</span>
              </th>
              <td className="py-2 text-right tabular-nums">{formatArs(prizeShares[i] ?? 0)}</td>
              <td className="py-2 text-right tabular-nums">{formatArs(goalShares[i] ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
