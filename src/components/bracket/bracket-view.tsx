import { cn } from "@/lib/utils";
import { layoutBracket } from "@/shared/bracket-layout";
import type { BracketSlot, BracketViewMatch, RoundTitle } from "@/shared/bracket-layout";
import { t } from "@/shared/i18n";
import type { MatchStatus } from "@/shared/match";

const IN_PLAY: MatchStatus[] = ["in_progress", "reported", "disputed"];

const roundTitle = (title: RoundTitle) => (title.key === "bracket.round.numbered" ? t(title.key, { n: title.n }) : t(title.key));

/**
 * The bracket, readable without JavaScript: each section (winners, losers, grand final; or bracket and third place)
 * is a stacked block with an anchor nav above; its rounds are columns in a region that scrolls on its own.
 */
export function BracketView({
  matches,
  highlightRegistrationId = null,
}: {
  bracket: "double_elimination" | "single_elimination";
  matches: BracketViewMatch[];
  highlightRegistrationId?: string | null;
}) {
  const sections = layoutBracket(matches);
  return (
    <div className="flex flex-col gap-10">
      {sections.length > 1 && (
        <nav aria-label={t("bracket.nav")}>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="font-display text-lg font-extrabold tracking-[0.04em] text-ink-muted uppercase underline-offset-4 hover:text-ink hover:underline"
                >
                  {t(`bracket.section.${section.id}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {sections.map((section) => {
        const name = t(`bracket.section.${section.id}`);
        return (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-h`} className="scroll-mt-6">
            <h3 id={`${section.id}-h`} className="font-display text-xl font-extrabold uppercase">
              {name}
            </h3>
            <div role="region" aria-label={t("bracket.scroll", { section: name })} tabIndex={0} className="bracket-scroll mt-3 overflow-x-auto pb-3">
              <ol className="flex w-max gap-5">
                {section.rounds.map((round) => (
                  <li key={round.round} className="flex w-[14rem] shrink-0 flex-col gap-3">
                    <h4 className="flex items-baseline justify-between gap-2 border-b border-line pb-1.5">
                      <span className="font-display text-base font-extrabold tracking-[0.04em] uppercase">{roundTitle(round.title)}</span>
                      <span className="text-xs text-ink-muted">{t("bracket.bestOf", { n: round.matches[0]?.bestOf ?? 1 })}</span>
                    </h4>
                    <ol className="flex flex-1 flex-col justify-around gap-3">
                      {round.matches.map((match) => (
                        <li key={`${match.phase}-${match.round}-${match.number}`}>
                          <MatchCard match={match} highlight={highlightRegistrationId} />
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MatchCard({ match, highlight }: { match: BracketViewMatch; highlight: string | null }) {
  const inPlay = IN_PLAY.includes(match.status);
  const body = (
    <>
      {match.bye ? (
        <>
          <SlotRow slot={match.slots.find((s) => s.registrationId) ?? match.slots[0]} highlight={highlight} showScore={false} />
          <p className="border-t border-line px-2.5 py-1.5 text-sm text-ink-muted">{t("bracket.bye")}</p>
        </>
      ) : (
        <>
          <SlotRow slot={match.slots[0]} highlight={highlight} showScore={match.status === "completed"} />
          <SlotRow slot={match.slots[1]} highlight={highlight} showScore={match.status === "completed"} divider />
        </>
      )}
      {inPlay && (
        <p className="border-t border-line px-2.5 py-1 font-display text-sm font-extrabold tracking-[0.06em] text-cobalt-light uppercase">
          {t("bracket.inPlay")}
        </p>
      )}
    </>
  );
  const frame = "block rounded-[4px] border border-line bg-surface";
  if (!match.matchId) return <div className={cn(frame, match.bye && "border-dashed")}>{body}</div>;
  return (
    <a href={`/partidas/${match.matchId}`} className={cn(frame, "transition-colors hover:border-cobalt-light", inPlay && "border-cobalt")}>
      {body}
    </a>
  );
}

function SlotRow({ slot, highlight, showScore, divider = false }: { slot: BracketSlot; highlight: string | null; showScore: boolean; divider?: boolean }) {
  const mine = slot.registrationId !== null && slot.registrationId === highlight;
  const lost = showScore && !slot.winner;
  return (
    <div className={cn("flex items-center gap-2 px-2.5 py-1.5", divider && "border-t border-line")}>
      <span className="w-5 shrink-0 text-right font-display text-sm font-extrabold text-ink-muted">{slot.seed ?? ""}</span>
      <span className="min-w-0 flex-1 leading-tight">
        {slot.name ? (
          <>
            <span
              className={cn(
                "[overflow-wrap:anywhere]",
                slot.winner ? "font-bold text-ink" : lost ? "text-ink-muted" : "text-ink",
                mine && "underline decoration-cobalt-light decoration-2 underline-offset-4",
              )}
            >
              {slot.name}
            </span>
            {mine && <span className="ml-1.5 text-xs font-semibold text-cobalt-light">{t("bracket.yourTeam")}</span>}
          </>
        ) : (
          <span className="text-ink-muted italic">{t("matchday.tbd")}</span>
        )}
      </span>
      {showScore && slot.score !== null && (
        <span className={cn("font-display text-xl leading-none font-black", slot.winner ? "text-ink" : "text-ink-muted")}>{slot.score}</span>
      )}
    </div>
  );
}
