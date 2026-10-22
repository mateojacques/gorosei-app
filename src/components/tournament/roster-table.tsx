import { useId } from "react";
import { Th } from "@/components/team/team-ui";
import type { RosterEntry } from "@/shared/eligibility";
import { t } from "@/shared/i18n";
import { formatRank } from "@/shared/rank";

/** A registered roster with each player's frozen snapshot rank and, when the tournament has a fee, their payment. */
export function RosterTable({ roster, showPaid }: { roster: (RosterEntry & { paid: boolean })[]; showPaid: boolean }) {
  const headingId = useId();
  return (
    <section>
      <h2 id={headingId} className="font-display text-2xl font-extrabold uppercase">
        {t("registration.roster")}
      </h2>
      <table aria-labelledby={headingId} className="mt-4 w-full border-collapse text-left">
        <thead>
          <tr>
            <Th>{t("registration.col.player")}</Th>
            <Th>{t("registration.col.rank")}</Th>
            {showPaid && <Th>{t("registration.col.paid")}</Th>}
          </tr>
        </thead>
        <tbody>
          {roster.map((player) => (
            <tr key={player.userId} className="border-b border-line align-top">
              <td className="py-3 pr-3">
                <span className="font-semibold [overflow-wrap:anywhere]">{player.riotId}</span>
                <span className="block text-sm text-ink-muted">
                  {player.isSub ? t("registration.sub") : t("registration.starter")}
                </span>
              </td>
              <td className="py-3 pr-3 font-display text-lg leading-tight font-extrabold uppercase">{formatRank(player.rank)}</td>
              {showPaid && (
                <td className={player.paid ? "py-3 font-semibold" : "py-3 text-ink-muted"}>
                  {player.paid ? `✓ ${t("registration.paid")}` : t("registration.unpaid")}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
