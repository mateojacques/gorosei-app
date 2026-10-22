import { TournamentStatusTag } from "@/components/tournament/registration-status";
import type { TournamentView } from "@/server/tournaments/tournament-view";
import { t } from "@/shared/i18n";
import { CupCountdown } from "./countdown";

export function Stage({ tournament }: { tournament: TournamentView | null }) {
  if (!tournament) {
    return (
      <section aria-labelledby="cup-title" className="stage relative isolate overflow-hidden px-4 pt-8 pb-10 sm:px-8 md:pt-16 md:pb-16">
        <div className="mx-auto max-w-6xl">
          <h1
            id="cup-title"
            className="max-w-4xl font-display text-[clamp(2.75rem,12vw,5rem)] leading-[0.9] font-black tracking-[-0.01em] uppercase"
          >
            {t("cup.none.title")}
          </h1>
          <p className="mt-5 max-w-prose text-lg">{t("cup.none.body")}</p>
        </div>
      </section>
    );
  }
  // The first word on its own line, the rest lit in cobalt: "Copa / Semanal LAS".
  const [first, ...rest] = tournament.title.split(" ");
  return (
    <section aria-labelledby="cup-title" className="stage relative isolate overflow-hidden px-4 pt-8 pb-10 sm:px-8 md:pt-16 md:pb-16">
      <div className="mx-auto max-w-6xl">
        <TournamentStatusTag status={tournament.status} />
        <p className="mt-6 font-display text-xl font-extrabold tracking-[0.06em] text-ink-muted uppercase">
          {t("cup.edition", { edition: tournament.edition })}
        </p>
        <h1
          id="cup-title"
          className="mt-1 font-display text-[clamp(3.5rem,19vw,6rem)] leading-[0.85] font-black tracking-[-0.01em] uppercase [overflow-wrap:anywhere]"
        >
          <span className="rise block">{first}</span>{" "}
          {rest.length > 0 && <span className="rise rise-delay block text-cobalt-light">{rest.join(" ")}</span>}
        </h1>
        <CupCountdown startsAt={new Date(tournament.startsAt)} className="mt-5" />
      </div>
    </section>
  );
}
