import { Button } from "@/components/ui/button";
import { TournamentStatusTag } from "@/components/tournament/registration-status";
import type { NextCup, TournamentResults } from "@/server/tournaments/results";
import { formatArs, formatCupDay, formatCupTime } from "@/shared/format";
import { t } from "@/shared/i18n";

/**
 * The top of a finished or cancelled cup: the champion banner (never invented: no standings, no champion),
 * the podium, and the one primary action, the next cup.
 */
export function AfterHero({
  title,
  edition,
  status,
  results,
  next,
}: {
  title: string;
  edition: number;
  status: "finished" | "cancelled";
  results: TournamentResults | null;
  next: NextCup | null;
}) {
  const champion = results?.podium.find((p) => p.rank === 1) ?? null;
  const others = results?.podium.filter((p) => p.rank !== 1) ?? [];
  return (
    <section aria-labelledby="cup-title" className="stage relative isolate overflow-hidden px-4 pt-8 pb-10 sm:px-8 md:pt-14 md:pb-14">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <div>
          <TournamentStatusTag status={status} />
          <p className="mt-4 font-display text-lg font-extrabold tracking-[0.06em] text-ink-muted uppercase">
            {t("tournament.edition", { edition })}
          </p>
          <h1
            id="cup-title"
            className="font-display text-[clamp(2.25rem,10vw,4rem)] leading-[0.9] font-black tracking-[-0.01em] uppercase [overflow-wrap:anywhere]"
          >
            {title}
          </h1>
        </div>

        {status === "cancelled" ? (
          <p className="max-w-prose text-lg">{t("stage.after.cancelled")}</p>
        ) : champion ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
              <p className="font-display text-xl font-extrabold tracking-[0.06em] text-ink-muted uppercase">{t("stage.after.champion")}</p>
              <a
                href={`/equipos/${champion.team.teamSlug}`}
                className="font-display text-[clamp(3rem,15vw,6rem)] leading-[0.85] font-black uppercase [overflow-wrap:anywhere] hover:text-cobalt-light"
              >
                {champion.team.teamName}
              </a>
              {champion.prizeArs !== null && champion.prizeArs > 0 && (
                <p className="mt-3 flex flex-wrap items-baseline gap-x-3">
                  <span className="font-display text-[clamp(2.5rem,12vw,4.5rem)] leading-none font-black text-cobalt-light">
                    {formatArs(champion.prizeArs)}
                  </span>
                  <span className="text-ink-muted">{t("stage.after.prizeWon")}</span>
                </p>
              )}
            </div>
            {others.length > 0 && (
              <div>
                <h2 className="sr-only">{t("stage.after.podium")}</h2>
                <ol className="flex flex-col border-b border-line sm:flex-row sm:border-b-0">
                  {others.map((p) => (
                    <li
                      key={p.team.registrationId}
                      className="flex items-baseline gap-3 border-t border-line py-3 sm:min-w-[14rem] sm:pr-8"
                    >
                      <span className="font-display text-2xl font-black text-ink-muted">{t("stage.after.place", { rank: p.rank })}</span>
                      <a href={`/equipos/${p.team.teamSlug}`} className="font-semibold [overflow-wrap:anywhere] hover:text-cobalt-light">
                        {p.team.teamName}
                      </a>
                      {p.prizeArs !== null && p.prizeArs > 0 && <span className="text-ink-muted">{formatArs(p.prizeArs)}</span>}
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        ) : (
          <p className="max-w-prose text-lg text-ink-muted">{t("stage.after.noResults")}</p>
        )}

        <div className="flex flex-col items-start gap-2">
          <Button asChild size="lg">
            <a href={next ? `/torneos/${next.slug}` : "/torneos"}>{t("stage.after.next")}</a>
          </Button>
          <p className="text-ink-muted">
            {next
              ? t("stage.after.nextCaption", {
                  title: next.title,
                  edition: next.edition,
                  day: formatCupDay(new Date(next.startsAt)),
                  time: formatCupTime(new Date(next.startsAt)),
                })
              : t("stage.after.nextNone")}
          </p>
        </div>
      </div>
    </section>
  );
}

export function VodList({ vods }: { vods: TournamentResults["vods"] }) {
  if (vods.length === 0) return null;
  return (
    <section aria-labelledby="vods-h">
      <h2 id="vods-h" className="font-display text-2xl font-extrabold uppercase">
        {t("stage.vods.title")}
      </h2>
      <ul className="mt-3 border-b border-line">
        {vods.map((v) => (
          <li key={v.matchId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-3">
            <span className="[overflow-wrap:anywhere]">
              <span className="font-semibold">
                {v.teams[0] || t("matchday.tbd")} {t("matchday.vs")} {v.teams[1] || t("matchday.tbd")}
              </span>{" "}
              <span className="text-ink-muted">
                · {t(`matchday.phase.${v.phase}`)} · {t("matchday.round", { round: v.round })}
              </span>
            </span>
            <a
              href={v.url}
              rel="noopener noreferrer nofollow"
              target="_blank"
              className="font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink"
            >
              {t("stage.vods.watch")}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
