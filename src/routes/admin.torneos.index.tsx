import { Link, createFileRoute } from "@tanstack/react-router";
import { useId } from "react";
import { Th } from "../components/team/team-ui";
import { buttonVariants } from "../components/ui/button";
import { listAdminTournaments } from "../server/tournaments/admin.functions";
import { formatCupDay, formatCupTime } from "../shared/format";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/admin/torneos/")({
  loader: () => listAdminTournaments(),
  head: () => ({ meta: [{ title: `${t("admin.tournaments.title")} · ${t("app.name")}` }] }),
  component: AdminTournamentsPage,
});

function AdminTournamentsPage() {
  const tournaments = Route.useLoaderData();
  const headingId = useId();
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 id={headingId} className="font-display text-[clamp(2.5rem,10vw,4rem)] leading-[0.9] font-black uppercase">
          {t("admin.tournaments.title")}
        </h1>
        <div className="flex flex-wrap items-center gap-5">
          <Link to="/admin/plantillas" className="font-display text-lg font-extrabold uppercase underline-offset-4 hover:underline">
            {t("admin.templates.title")}
          </Link>
          <Link to="/admin/torneos/nuevo" className={buttonVariants()}>
            {t("admin.tournaments.new")}
          </Link>
        </div>
      </div>
      {tournaments.length === 0 ? (
        <p className="mt-8 text-ink-muted">{t("admin.tournaments.empty")}</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table aria-labelledby={headingId} className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr>
                <Th>{t("admin.col.tournament")}</Th>
                <Th>{t("admin.col.edition")}</Th>
                <Th>{t("admin.col.startsAt")}</Th>
                <Th>{t("admin.col.status")}</Th>
                <Th>{t("admin.col.confirmed")}</Th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((tournament) => {
                const startsAt = new Date(tournament.startsAt);
                return (
                  <tr key={tournament.id} className="border-b border-line align-top">
                    <td className="py-2.5 pr-3">
                      <Link
                        to="/admin/torneos/$id"
                        params={{ id: tournament.id }}
                        className="font-semibold underline-offset-4 hover:text-cobalt-light hover:underline"
                      >
                        {tournament.title}
                      </Link>
                      <span className="block text-ink-muted">{tournament.slug}</span>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">#{tournament.edition}</td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {formatCupDay(startsAt)} {formatCupTime(startsAt)}
                    </td>
                    <td className="py-2.5 pr-3">{t(`tournament.status.${tournament.status}`)}</td>
                    <td className="py-2.5 tabular-nums">
                      {tournament.confirmedCount}/{tournament.teamCap}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
