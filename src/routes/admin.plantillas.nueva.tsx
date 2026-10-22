import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { TemplateForm } from "../components/tournament/template-form";
import { createTemplateFn } from "../server/tournaments/templates.functions";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/admin/plantillas/nueva")({
  head: () => ({ meta: [{ title: `${t("admin.templates.new")} · ${t("app.name")}` }] }),
  component: NewTemplatePage,
});

function NewTemplatePage() {
  const navigate = useNavigate();
  return (
    <div className="max-w-3xl">
      <Link to="/admin/plantillas" className="font-display text-lg font-extrabold text-ink-muted uppercase hover:text-ink">
        {t("admin.templates.title")}
      </Link>
      <h1 className="mt-1 mb-8 font-display text-[clamp(2.5rem,10vw,4rem)] leading-[0.9] font-black uppercase">
        {t("admin.templates.new")}
      </h1>
      <TemplateForm
        submitLabel={t("admin.template.form.create")}
        onSubmit={async (input) => {
          const result = await createTemplateFn({ data: { input } });
          if (result.ok) await navigate({ to: "/admin/plantillas/$id", params: { id: result.id } });
          return result;
        }}
      />
    </div>
  );
}
