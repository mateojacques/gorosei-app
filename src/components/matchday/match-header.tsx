import { t } from "@/shared/i18n";
import type { MatchView } from "../../server/bracket/bracket";

const teamName = (team: MatchView["teams"][number]) => team?.name ?? t("matchday.tbd");

/** The scoreboard line of a match: teams, score, phase and state. The status is plain text; red is for the one action. */
export function MatchHeader({ match, tournament }: { match: MatchView; tournament: { title: string; edition: number } }) {
  const [a, b] = match.teams;
  const done = match.status === "completed";
  const winner = match.teams.find((team) => team?.registrationId === match.winnerRegistrationId);
  return (
    <header className="flex flex-col gap-3">
      <p className="font-display text-lg font-extrabold tracking-[0.04em] text-ink-muted uppercase">
        {tournament.title} #{tournament.edition} · {t(`matchday.phase.${match.phase}`)} · {t("matchday.round", { round: match.round })} ·{" "}
        {t("matchday.bestOf", { bestOf: match.bestOf })}
      </p>
      <h1 className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 font-display text-[clamp(1.75rem,7vw,3rem)] leading-none font-black uppercase">
        <span className="text-right [overflow-wrap:anywhere]">{teamName(a)}</span>
        <span className="text-cobalt-light tabular-nums" aria-label={done ? `${match.score[0]} a ${match.score[1]}` : undefined}>
          {done ? `${match.score[0] ?? 0}–${match.score[1] ?? 0}` : t("matchday.vs")}
        </span>
        <span className="[overflow-wrap:anywhere]">{teamName(b)}</span>
      </h1>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-display text-xl font-extrabold uppercase">
        <span>{t(`matchday.status.${match.status}`)}</span>
        {match.delayed && <span className="text-ink-muted">{t("matchday.delayed")}</span>}
        {done && winner && <span className="text-cobalt-light">{t("matchday.winner", { team: winner.name })}</span>}
      </p>
    </header>
  );
}
