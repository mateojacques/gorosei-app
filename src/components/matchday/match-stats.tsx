import { t } from "@/shared/i18n";
import type { MatchStats } from "../../server/matchday/stats";
import { Th } from "../team/team-ui";

/** Picks, bans and KDA pulled once from Riot match data. */
export function MatchStatsTable({ stats }: { stats: MatchStats[] }) {
  return (
    <section aria-labelledby="stats-h" className="flex flex-col gap-6">
      <h2 id="stats-h" className="font-display text-2xl font-extrabold uppercase">
        {t("matchday.stats.title")}
      </h2>
      {stats.map((game) => (
        <div key={game.matchId} className="flex flex-col gap-2">
          <p className="font-display text-lg font-extrabold uppercase tabular-nums">
            {game.matchId} · {t("matchday.stats.duration", { minutes: Math.round(game.durationSeconds / 60) })}
          </p>
          <table className="w-full max-w-xl border-collapse text-left">
            <thead>
              <tr>
                <Th>{t("matchday.stats.col.player")}</Th>
                <Th>{t("matchday.stats.col.champion")}</Th>
                <Th>{t("matchday.stats.col.kda")}</Th>
              </tr>
            </thead>
            <tbody>
              {game.players.map((p) => (
                <tr key={p.puuid} className="border-b border-line">
                  <td className="py-2 pr-3 [overflow-wrap:anywhere]">{p.riotId ?? "—"}</td>
                  <td className="py-2 pr-3">{p.championName}</td>
                  <td className="py-2 tabular-nums">
                    {p.kills}/{p.deaths}/{p.assists}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}
