import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { authClient } from "../auth-client";
import { type FormEvent, type ReactNode, useEffect, useId, useState } from "react";
import {
  confirmRiotLinkFn,
  getRiotLinkState,
  startRiotLinkFn,
} from "../server/identity/link-riot.functions";
import { CaptionBar } from "../components/cup/caption-bar";
import { Field, FormAlert } from "../components/site/form";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { type MessageKey, t } from "../shared/i18n";
import { formatRiotId } from "../shared/riot-id";
import { NOINDEX_META } from "../shared/seo";

export const Route = createFileRoute("/vincular-riot")({
  loader: () => getRiotLinkState(),
  head: () => ({ meta: [{ title: `${t("riotLink.title")} · ${t("app.name")}` }, NOINDEX_META] }),
  component: LinkRiotPage,
});

type Challenge = { requiredIconId: number; iconUrl: string; expiresAt: Date };

function LinkRiotPage() {
  const state = Route.useLoaderData();
  const router = useRouter();
  const [challenge, setChallenge] = useState<Challenge | null>(state.signedIn ? state.challenge : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const id = useId();

  if (!state.signedIn) {
    return (
      <Page>
        <p className="mt-6 text-lg">{t("riotLink.signInRequired")}</p>
        <Link to="/ingresar" className={buttonVariants({ size: "lg", className: "mt-6 w-full" })}>
          {t("auth.title")}
        </Link>
      </Page>
    );
  }

  if (state.linked) {
    return (
      <Page>
        <p role="status" className="mt-6 text-lg">
          {t("riotLink.success", { riotId: formatRiotId(state.linked) })}
        </p>
      </Page>
    );
  }

  if (state.rso) return <RsoLink />;

  async function onStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const riotId = String(new FormData(event.currentTarget).get("riotId"));
    setPending(true);
    setError(null);
    const result = await startRiotLinkFn({ data: { riotId } });
    setPending(false);
    if (result.ok) setChallenge({ requiredIconId: result.requiredIconId, iconUrl: result.iconUrl, expiresAt: result.expiresAt });
    else setError(t(`riotLink.error.${result.reason}`));
  }

  async function onConfirm() {
    if (!challenge) return;
    setPending(true);
    setError(null);
    const result = await confirmRiotLinkFn();
    setPending(false);
    if (result.ok) {
      await router.invalidate();
      return;
    }
    const key: MessageKey = `riotLink.error.${result.reason}`;
    setError(t(key));
    if (result.reason === "expired" || result.reason === "no_challenge") setChallenge(null);
  }

  return (
    <Page>
      {challenge ? (
        <section className="mt-6 flex flex-col gap-5">
          <p className="text-lg">{t("riotLink.setIcon")}</p>
          <div className="flex items-center gap-5">
            <img
              src={challenge.iconUrl}
              alt={t("riotLink.iconAlt")}
              width={128}
              height={128}
              className="size-32 shrink-0 rounded-[8px] border-2 border-cobalt-light bg-surface-raised"
            />
            <p className="text-ink-muted">{t("riotLink.iconHint")}</p>
          </div>
          <CaptionBar block={t("riotLink.verifying")}>
            <Countdown until={challenge.expiresAt} />
          </CaptionBar>
          <Button type="button" size="lg" onClick={onConfirm} disabled={pending} className="mt-2 w-full">
            {t("riotLink.confirm")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setChallenge(null)} className="h-auto self-start px-0">
            {t("riotLink.restart")}
          </Button>
        </section>
      ) : (
        <form onSubmit={onStart} className="mt-6 flex flex-col gap-5">
          <p className="text-lg">{t("riotLink.intro")}</p>
          <Field id={`${id}-riot-id`} label={t("riotLink.riotId")}>
            <Input
              id={`${id}-riot-id`}
              name="riotId"
              required
              autoComplete="off"
              placeholder={t("riotLink.riotIdPlaceholder")}
              aria-invalid={error ? true : undefined}
            />
          </Field>
          <Button type="submit" size="lg" disabled={pending} className="w-full">
            {t("riotLink.start")}
          </Button>
        </form>
      )}

      {error && (
        <div className="mt-5">
          <FormAlert>{error}</FormAlert>
        </div>
      )}
    </Page>
  );
}

/** With Riot Sign On the player links by signing in to Riot; the icon challenge is not offered. */
function RsoLink() {
  const [pending, setPending] = useState(false);
  // Better Auth comes back to this page with ?error=… when Riot or the link was refused.
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(new URLSearchParams(window.location.search).has("error")), []);
  return (
    <Page>
      <p className="mt-6 text-lg">{t("riotLink.rsoIntro")}</p>
      <Button
        type="button"
        size="lg"
        disabled={pending}
        className="mt-6 w-full"
        onClick={() => {
          setPending(true);
          void authClient.linkSocial({ provider: "riot", callbackURL: "/vincular-riot" }).finally(() => setPending(false));
        }}
      >
        {t("riotLink.rso")}
      </Button>
      {failed && (
        <div className="mt-5">
          <FormAlert>{t("riotLink.rsoFailed")}</FormAlert>
        </div>
      )}
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="px-4 py-12 sm:px-8 md:py-20">
      <div className="mx-auto max-w-md">
        <h1 className="font-display text-[clamp(2.5rem,12vw,4rem)] leading-[0.9] font-black uppercase">
          {t("riotLink.title")}
        </h1>
        {children}
      </div>
    </main>
  );
}

function Countdown({ until }: { until: Date }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return <span aria-live="off">{t("riotLink.timeLeft", { time })}</span>;
}
