import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import { authClient } from "../auth-client";
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

const AFTER_SIGN_IN = "/";

function SignInPage() {
  const { discord } = Route.useLoaderData();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

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
    if (result.error) setError(true);
    else await navigate({ to: AFTER_SIGN_IN });
  }

  return (
    <main className="mx-auto max-w-sm p-4">
      <h1 className="mb-4 text-2xl font-bold">{t("auth.title")}</h1>

      {discord && (
        <>
          <button
            type="button"
            className="w-full border px-3 py-2"
            onClick={() => authClient.signIn.social({ provider: "discord", callbackURL: AFTER_SIGN_IN })}
          >
            {t("auth.discord")}
          </button>
          <p className="my-4 text-center">{t("auth.or")}</p>
        </>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === "signUp" && (
          <label className="flex flex-col">
            {t("auth.name")}
            <input name="name" required autoComplete="nickname" className="border px-2 py-1" />
          </label>
        )}
        <label className="flex flex-col">
          {t("auth.email")}
          <input name="email" type="email" required autoComplete="email" className="border px-2 py-1" />
        </label>
        <label className="flex flex-col">
          {t("auth.password")}
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signUp" ? "new-password" : "current-password"}
            className="border px-2 py-1"
          />
        </label>
        {error && <p role="alert">{t("auth.failed")}</p>}
        <button type="submit" disabled={pending} className="border px-3 py-2 font-bold">
          {t(mode === "signUp" ? "auth.signUp" : "auth.signIn")}
        </button>
      </form>

      <button
        type="button"
        className="mt-4 underline"
        onClick={() => setMode(mode === "signUp" ? "signIn" : "signUp")}
      >
        {t(mode === "signUp" ? "auth.haveAccount" : "auth.noAccount")}
      </button>
    </main>
  );
}
