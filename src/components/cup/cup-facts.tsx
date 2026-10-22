import type { ReactNode } from "react";
import type { TournamentView } from "@/server/tournaments/tournament-view";
import { formatArs } from "@/shared/format";
import { t } from "@/shared/i18n";

const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

export function CupFacts({ tournament }: { tournament: TournamentView }) {
  return (
    <dl className="border-b border-line">
      <Fact label={t("cup.who")}>
        {tournament.rules.length > 0 ? t("cup.whoValue", { rules: tournament.rules.join(". ") }) : t("cup.whoOpen")}
      </Fact>
      <Fact label={t("cup.what")}>
        {t("cup.whatValue", { bracket: t(`cup.bracket.${tournament.bracket}`), teams: tournament.teamCap })}
      </Fact>
      <Fact label={t("cup.where")}>
        {isWebUrl(tournament.streamUrl) ? (
          <>
            {t("cup.whereValue")}{" "}
            <a href={tournament.streamUrl} className="font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink">
              {t("cup.whereStream")}
            </a>
            .
          </>
        ) : (
          t("cup.whereOnline")
        )}
      </Fact>
      <Fact label={t("cup.entry")}>
        {tournament.entryFeeArs === 0 ? (
          t("cup.entryFree")
        ) : (
          <>
            {t("cup.entryValue", { fee: formatArs(tournament.entryFeeArs) })} ·{" "}
            <strong className="font-bold text-ink">{t("cup.poolNote")}</strong> ·{" "}
            {t("cup.poolNow", { pool: formatArs(tournament.poolArs) })}
          </>
        )}
      </Fact>
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-4 sm:grid-cols-[8rem_1fr] sm:gap-4">
      <dt className="font-display text-lg leading-tight font-extrabold tracking-[0.04em] text-ink-muted uppercase">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
