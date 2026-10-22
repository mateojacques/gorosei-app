import { Link, createFileRoute } from "@tanstack/react-router";
import { useId } from "react";
import { Th } from "../components/team/team-ui";
import { buttonVariants } from "../components/ui/button";
import { listTemplatesFn } from "../server/tournaments/templates.functions";
import { formatCupDay, formatCupTime } from "../shared/format";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/admin/plantillas/")({
  loader: () => listTemplatesFn(),
  head: () => ({ meta: [{ title: `${t("admin.templates.title")} · ${t("app.name")}` }] }),
  component: AdminTemplatesPage,
});

type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

function AdminTemplatesPage() {
  const templates = Route.useLoaderData();
  const headingId = useId();
  return (
    <>
      <Link to="/admin/torneos" className="font-display text-lg font-extrabold text-ink-muted uppercase hover:text-ink">
        {t("admin.backToList")}
      </Link>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
        <h1 id={headingId} className="font-display text-[clamp(2.5rem,10vw,4rem)] leading-[0.9] font-black uppercase">
          {t("admin.templates.title")}
        </h1>
        <Link to="/admin/plantillas/nueva" className={buttonVariants()}>
          {t("admin.templates.new")}
        </Link>
      </div>
      {templates.length === 0 ? (
        <p className="mt-8 max-w-prose text-ink-muted">{t("admin.templates.empty")}</p>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table aria-labelledby={headingId} className="w-full min-w-[36rem] border-collapse text-left text-sm">
            <thead>
              <tr>
                <Th>{t("admin.templates.col.template")}</Th>
                <Th>{t("admin.templates.col.schedule")}</Th>
                <Th>{t("admin.templates.col.next")}</Th>
                <Th>{t("admin.templates.col.latest")}</Th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const next = template.nextStartsAt ? new Date(template.nextStartsAt) : null;
                return (
                  <tr key={template.id} className="border-b border-line align-top">
                    <td className="py-2.5 pr-3">
                      <Link
                        to="/admin/plantillas/$id"
                        params={{ id: template.id }}
                        className="font-semibold underline-offset-4 hover:text-cobalt-light hover:underline"
                      >
                        {template.title}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {t("admin.templates.schedule", {
                        weekday: t(`template.weekday.${template.weekday as Weekday}`),
                        time: template.startTime,
                      })}
                    </td>
                    <td className="py-2.5 pr-3 tabular-nums">
                      {next
                        ? t("admin.templates.next", {
                            edition: template.nextEdition,
                            date: `${formatCupDay(next)} ${formatCupTime(next)}`,
                          })
                        : t("admin.templates.paused")}
                    </td>
                    <td className="py-2.5 tabular-nums">
                      {template.latest ? (
                        <Link
                          to="/admin/torneos/$id"
                          params={{ id: template.latest.id }}
                          className="underline underline-offset-4 hover:text-cobalt-light"
                        >
                          #{template.latest.edition} · {t(`tournament.status.${template.latest.status}`)}
                        </Link>
                      ) : (
                        <span className="text-ink-muted">{t("admin.templates.noEditions")}</span>
                      )}
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
