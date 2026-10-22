import { TournamentStatusTag } from "@/components/tournament/registration-status";
import type { BracketViewMatch } from "@/shared/bracket-layout";
import { t } from "@/shared/i18n";
import type { MatchStatus } from "@/shared/match";
import { TwitchEmbed } from "./twitch-embed";

const IN_PLAY: MatchStatus[] = ["in_progress", "reported", "disputed"];

/** The live top of the page: a compact hero, then the stream and chat. */
export function LiveHero({ title, edition, streamUrl }: { title: string; edition: number; streamUrl: string }) {
  return (
    <section aria-labelledby="cup-title" className="stage relative isolate overflow-hidden px-4 pt-8 pb-10 sm:px-8 md:pt-12">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div>
          <TournamentStatusTag status="live" />
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
        <TwitchEmbed streamUrl={streamUrl} />
      </div>
    </section>
  );
}

/** The matches being played right now, each a way into its match page. */
export function InPlayList({ matches }: { matches: BracketViewMatch[] }) {
  const playing = matches.filter((m) => m.matchId && IN_PLAY.includes(m.status));
  return (
    <section aria-labelledby="in-play-h">
      <h2 id="in-play-h" className="font-display text-2xl font-extrabold uppercase">
        {t("stage.live.inPlay")}
      </h2>
      {playing.length === 0 ? (
        <p className="mt-3 text-ink-muted">{t("stage.live.inPlayEmpty")}</p>
      ) : (
        <ul className="mt-3 border-b border-line">
          {playing.map((m) => (
            <li key={m.matchId} className="border-t border-line">
              <a href={`/partidas/${m.matchId}`} className="group flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                <span className="font-semibold [overflow-wrap:anywhere] group-hover:text-cobalt-light">
                  {m.slots[0].name ?? t("matchday.tbd")} <span className="text-ink-muted">{t("matchday.vs")}</span>{" "}
                  {m.slots[1].name ?? t("matchday.tbd")}
                </span>
                <span className="font-display text-base font-extrabold tracking-[0.04em] text-cobalt-light uppercase">
                  {t(`matchday.phase.${m.phase}`)} · {t("matchday.round", { round: m.round })}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
