import { Link, createFileRoute, useLoaderData, useNavigate, useRouter } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { Field, FormAlert } from "../components/site/form";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { createTeamFn } from "../server/teams/teams.functions";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/equipos/nuevo")({
  head: () => ({ meta: [{ title: `${t("team.create.title")} · ${t("app.name")}` }] }),
  component: CreateTeamPage,
});

function CreateTeamPage() {
  const viewer = useLoaderData({ from: "__root__" });
  const router = useRouter();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await createTeamFn({ data: { name: String(form.get("name")), tag: String(form.get("tag")) } });
      if (!result.ok) {
        setError(t(`team.error.${result.reason}`));
        return;
      }
      await router.invalidate();
      await navigate({ to: "/equipos/$slug", params: { slug: result.slug } });
    } catch {
      // An expired session or a dropped connection must not leave the form locked and silent.
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="px-4 py-12 sm:px-8 md:py-20">
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-[clamp(2.5rem,12vw,4rem)] leading-[0.9] font-black uppercase">
          {t("team.create.title")}
        </h1>
        {viewer.signedIn ? (
          <form method="post" onSubmit={onSubmit} className="mt-6 flex flex-col gap-5">
            <p className="text-lg">{t("team.create.intro")}</p>
            <Field id={`${id}-name`} label={t("team.create.name")}>
              <Input
                id={`${id}-name`}
                name="name"
                required
                minLength={3}
                maxLength={24}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
              />
            </Field>
            <Field id={`${id}-tag`} label={t("team.create.tag")}>
              <Input
                id={`${id}-tag`}
                name="tag"
                required
                minLength={2}
                maxLength={5}
                autoComplete="off"
                aria-describedby={`${id}-tag-hint`}
                aria-invalid={error ? true : undefined}
                className="uppercase"
              />
              <p id={`${id}-tag-hint`} className="text-sm text-ink-muted">
                {t("team.create.tagHint")}
              </p>
            </Field>
            {error && <FormAlert>{error}</FormAlert>}
            <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
              {t("team.create.submit")}
            </Button>
          </form>
        ) : (
          <>
            <p className="mt-6 text-lg">{t("team.signInRequired")}</p>
            <Link to="/ingresar" className={buttonVariants({ size: "lg", className: "mt-6 w-full" })}>
              {t("auth.title")}
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
