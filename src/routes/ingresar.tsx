import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type FormEvent, useId, useState } from "react";
import { authClient } from "../auth-client";
import { Field, FormAlert } from "../components/site/form";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { t } from "../shared/i18n";

const getAuthOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { isDiscordEnabled } = await import("../server/auth");
  return { discord: isDiscordEnabled };
});

export const Route = createFileRoute("/ingresar")({
  loader: () => getAuthOptions(),
  head: () => ({ meta: [{ title: `${t("auth.title")} · ${t("app.name")}` }] }),
  component: SignInPage,
});

const AFTER_SIGN_IN = "/vincular-riot";

function SignInPage() {
  const { discord } = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const id = useId();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setPending(true);
    setError(false);
    const result =
      mode === "signUp"
        ? await authClient.signUp.email({ name: String(form.get("name")), email, password })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(true);
      return;
    }
    // The root loader holds the viewer state; refresh it so the header and CTAs see the new session.
    await router.invalidate();
    await navigate({ to: AFTER_SIGN_IN });
  }

  return (
    <main className="px-4 py-12 sm:px-8 md:py-20">
      <div className="mx-auto max-w-sm">
        <h1 className="font-display text-[clamp(2.5rem,12vw,4rem)] leading-[0.9] font-black uppercase">
          {t(mode === "signUp" ? "auth.signUp" : "auth.title")}
        </h1>

        {discord && (
          <>
            <Button
              type="button"
              variant="secondary"
              className="mt-8 w-full"
              onClick={() => authClient.signIn.social({ provider: "discord", callbackURL: AFTER_SIGN_IN })}
            >
              {t("auth.discord")}
            </Button>
            <p className="my-6 flex items-center gap-3 text-sm text-ink-muted before:h-px before:grow before:bg-line after:h-px after:grow after:bg-line">
              {t("auth.or")}
            </p>
          </>
        )}

        <form onSubmit={onSubmit} className={`flex flex-col gap-5 ${discord ? "" : "mt-8"}`}>
          {mode === "signUp" && (
            <Field id={`${id}-name`} label={t("auth.name")}>
              <Input id={`${id}-name`} name="name" required autoComplete="nickname" />
            </Field>
          )}
          <Field id={`${id}-email`} label={t("auth.email")}>
            <Input id={`${id}-email`} name="email" type="email" required autoComplete="email" aria-invalid={error || undefined} />
          </Field>
          <Field id={`${id}-password`} label={t("auth.password")}>
            <Input
              id={`${id}-password`}
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signUp" ? "new-password" : "current-password"}
              aria-invalid={error || undefined}
            />
          </Field>
          {error && <FormAlert>{t("auth.failed")}</FormAlert>}
          <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full">
            {t(mode === "signUp" ? "auth.signUp" : "auth.signIn")}
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          className="mt-4 h-auto px-0 font-semibold"
          onClick={() => setMode(mode === "signUp" ? "signIn" : "signUp")}
        >
          {t(mode === "signUp" ? "auth.haveAccount" : "auth.noAccount")}
        </Button>
      </div>
    </main>
  );
}
