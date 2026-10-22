import { Link } from "@tanstack/react-router";
import { t } from "@/shared/i18n";
import type { ConsoleItem } from "../../server/bracket/bracket";
import { Th } from "../team/team-ui";

const since = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** The work queue: one dense row per match that needs a moderator, most urgent first. */
export function ConsoleQueue({ items, selectedId }: { items: ConsoleItem[]; selectedId?: string }) {
  if (items.length === 0) return <p className="max-w-prose text-ink-muted">{t("console.empty")}</p>;
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr>
          <Th>{t("console.col.kind")}</Th>
          <Th>{t("console.col.match")}</Th>
          <Th>{t("console.col.reports")}</Th>
          <Th>{t("console.col.since")}</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const selected = item.matchId === selectedId;
          return (
            <tr key={item.matchId} className={`border-b border-line align-top ${selected ? "bg-surface-raised" : ""}`}>
              <td className="py-2 pr-3 font-display text-lg font-extrabold uppercase">{t(`console.kind.${item.kind}`)}</td>
              <td className="py-2 pr-3">
                <Link
                  to="/mod"
                  search={{ match: item.matchId }}
                  aria-current={selected ? "true" : undefined}
                  className="font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:text-cobalt-light hover:underline"
                >
                  {item.teams[0] || t("matchday.tbd")} {t("matchday.vs")} {item.teams[1] || t("matchday.tbd")}
                </Link>
                <span className="block text-sm text-ink-muted">
                  {item.tournamentSlug} · {t("matchday.round", { round: item.round })}
                </span>
              </td>
              <td className="py-2 pr-3 tabular-nums">{item.reportCount}</td>
              <td className="py-2 text-ink-muted tabular-nums">{since.format(new Date(item.since))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
