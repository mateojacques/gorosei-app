import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { TournamentForm } from "../components/tournament/tournament-form";
import { createTournamentFn } from "../server/tournaments/admin.functions";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/admin/torneos/nuevo")({
  head: () => ({ meta: [{ title: `${t("admin.tournaments.new")} · ${t("app.name")}` }] }),
  component: NewTournamentPage,
});

function NewTournamentPage() {
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl">
      <Link to="/admin/torneos" className="font-display text-lg font-extrabold text-ink-muted uppercase hover:text-ink">
        {t("admin.backToList")}
      </Link>
      <h1 className="mt-1 mb-8 font-display text-[clamp(2.5rem,10vw,4rem)] leading-[0.9] font-black uppercase">
        {t("admin.tournaments.new")}
      </h1>
      <TournamentForm
        submitLabel={t("admin.form.create")}
        onSubmit={async (input) => {
          const result = await createTournamentFn({ data: { input } });
          if (result.ok) await navigate({ to: "/admin/torneos/$id", params: { id: result.id } });
          return result;
        }}
      />
    </div>
  );
}
