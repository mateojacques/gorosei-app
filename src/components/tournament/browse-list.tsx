import { TournamentStatusTag } from "@/components/tournament/registration-status";
import type { BrowseTournament } from "@/shared/browse";
import { formatArs, formatCupDay, formatCupTime } from "@/shared/format";
import { t } from "@/shared/i18n";
import { splitPrize } from "@/shared/prize";

type Section = "upcoming" | "live" | "finished";

/** One section of the schedule: a heading and its rows, newest broadcast first where it matters. */
export function BrowseSection({ section, tournaments }: { section: Section; tournaments: BrowseTournament[] }) {
  if (tournaments.length === 0) return null;
  const headingId = `browse-${section}`;
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="flex items-baseline gap-3 font-display text-3xl font-black uppercase sm:text-4xl">
        {t(`browse.section.${section}`)}
        <span className="text-xl font-extrabold text-ink-muted">{tournaments.length}</span>
      </h2>
      <ol className="mt-4 border-b border-line">
        {tournaments.map((tournament) => (
          <BrowseRow key={tournament.slug} tournament={tournament} />
        ))}
      </ol>
    </section>
  );
}

// Red means live: only the rows that are open or on air carry the status tag.
const TAGGED = new Set(["registration_open", "check_in", "live"]);

function BrowseRow({ tournament }: { tournament: BrowseTournament }) {
  const startsAt = new Date(tournament.startsAt);
  const prize = splitPrize(tournament.prizeGoalArs, tournament.prizeSplit)[0] ?? 0;
  const facts = [
    t(`cup.bracket.${tournament.bracket}`),
    tournament.rankBracket === "open" ? t("browse.rankOpen") : t("browse.rankCap", { tier: t(`rank.tier.${tournament.rankBracket}`) }),
    tournament.entryFeeArs === 0 ? t("browse.free") : t("browse.fee", { fee: formatArs(tournament.entryFeeArs) }),
    t("browse.teams", { count: tournament.confirmedCount, cap: tournament.teamCap }),
  ];
  return (
    <li className="group relative grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 border-t border-line py-5 sm:grid-cols-[7.5rem_minmax(0,1fr)_auto] sm:items-center sm:gap-x-6">
      {/* A small lower-third: the day on the cobalt block, the time on the light bar. */}
      <p className="flex w-[5.5rem] flex-col font-display leading-none font-extrabold uppercase sm:w-auto">
        <time dateTime={startsAt.toISOString()} className="contents">
          <span className="bg-cobalt px-2 py-2 text-lg tracking-[0.04em] text-ink sm:text-xl">{formatCupDay(startsAt)}</span>
          <span className="bg-ink px-2 py-1.5 text-base tracking-[0.02em] text-surface">
            {formatCupTime(startsAt)} {t("cup.timeZone")}
          </span>
        </time>
      </p>

      <div className="min-w-0">
        <h3 className="font-display text-2xl leading-[0.95] font-black uppercase [overflow-wrap:anywhere] sm:text-3xl">
          <a
            href={`/torneos/${tournament.slug}`}
            className="after:absolute after:inset-0 after:content-[''] group-hover:text-cobalt-light focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-cobalt-light"
          >
            {tournament.title} <span className="text-ink-muted">#{tournament.edition}</span>
          </a>
        </h3>
        <p className="mt-2 text-sm text-ink-muted sm:text-base">{facts.join(" · ")}</p>
      </div>

      <div className="col-start-2 flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-start-3 sm:flex-col sm:items-end sm:text-right">
        {prize > 0 && (
          <p className="flex items-baseline gap-2 sm:flex-col sm:items-end sm:gap-0">
            <span className="font-display text-3xl leading-none font-black text-cobalt-light sm:text-4xl">{formatArs(prize)}</span>
            <span className="text-sm text-ink-muted">{t("browse.prize")}</span>
          </p>
        )}
        {TAGGED.has(tournament.status) ? (
          <TournamentStatusTag status={tournament.status} />
        ) : (
          <p className="font-display text-base leading-none font-extrabold tracking-[0.08em] text-ink-muted uppercase">
            {t(`tournament.status.${tournament.status}`)}
          </p>
        )}
      </div>
    </li>
  );
}
