import { Link, createFileRoute } from "@tanstack/react-router";
import { TemplateForm, toTemplateFormValues } from "../components/tournament/template-form";
import { getTemplateFn, updateTemplateFn } from "../server/tournaments/templates.functions";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/admin/plantillas/$id")({
  loader: ({ params }) => getTemplateFn({ data: { id: params.id } }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.title ?? t("admin.template.error.not_found")} · ${t("app.name")}` }],
  }),
  component: TemplatePage,
});

function TemplatePage() {
  const template = Route.useLoaderData();
  return (
    <div className="max-w-3xl">
      <Link to="/admin/plantillas" className="font-display text-lg font-extrabold text-ink-muted uppercase hover:text-ink">
        {t("admin.templates.title")}
      </Link>
      <h1 className="mt-1 mb-3 font-display text-[clamp(2.5rem,10vw,4rem)] leading-[0.9] font-black uppercase [overflow-wrap:anywhere]">
        {template.title}
      </h1>
      <p className="mb-8 max-w-prose text-ink-muted">{t("admin.template.editNote")}</p>
      <TemplateForm
        key={`${template.id}-${String(template.updatedAt)}`}
        initial={toTemplateFormValues(template)}
        submitLabel={t("admin.form.save")}
        onSubmit={(input) => updateTemplateFn({ data: { id: template.id, input } })}
      />
    </div>
  );
}
