import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import {
  confirmRiotLinkFn,
  getRiotLinkState,
  startRiotLinkFn,
} from "../server/identity/link-riot.functions";
import { type MessageKey, t } from "../shared/i18n";
import { formatRiotId } from "../shared/riot-id";

export const Route = createFileRoute("/vincular-riot")({
  loader: () => getRiotLinkState(),
  head: () => ({ meta: [{ title: `${t("riotLink.title")} · ${t("app.name")}` }] }),
  component: LinkRiotPage,
});

type Challenge = { requiredIconId: number; expiresAt: Date };

function LinkRiotPage() {
  const state = Route.useLoaderData();
  const router = useRouter();
  const [challenge, setChallenge] = useState<Challenge | null>(state.signedIn ? state.challenge : null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!state.signedIn) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="mb-4 text-2xl font-bold">{t("riotLink.title")}</h1>
        <p>
          <Link to="/ingresar" className="underline">
            {t("riotLink.signInRequired")}
          </Link>
        </p>
      </main>
    );
  }

  if (state.linked) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="mb-4 text-2xl font-bold">{t("riotLink.title")}</h1>
        <p role="status">{t("riotLink.success", { riotId: formatRiotId(state.linked) })}</p>
      </main>
    );
  }

  async function onStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const riotId = String(new FormData(event.currentTarget).get("riotId"));
    setPending(true);
    setError(null);
    const result = await startRiotLinkFn({ data: { riotId } });
    setPending(false);
    if (result.ok) setChallenge({ requiredIconId: result.requiredIconId, expiresAt: result.expiresAt });
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
    setError(t(key, { iconId: challenge.requiredIconId }));
    if (result.reason === "expired" || result.reason === "no_challenge") setChallenge(null);
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="mb-4 text-2xl font-bold">{t("riotLink.title")}</h1>

      {challenge ? (
        <section className="flex flex-col gap-3">
          <p>{t("riotLink.setIcon", { iconId: challenge.requiredIconId })}</p>
          <Countdown until={challenge.expiresAt} />
          <button type="button" onClick={onConfirm} disabled={pending} className="border px-3 py-2 font-bold">
            {t("riotLink.confirm")}
          </button>
          <button type="button" onClick={() => setChallenge(null)} className="underline">
            {t("riotLink.restart")}
          </button>
        </section>
      ) : (
        <form onSubmit={onStart} className="flex flex-col gap-3">
          <p>{t("riotLink.intro")}</p>
          <label className="flex flex-col">
            {t("riotLink.riotId")}
            <input name="riotId" required placeholder="nombre#LAS" className="border px-2 py-1" />
          </label>
          <button type="submit" disabled={pending} className="border px-3 py-2 font-bold">
            {t("riotLink.start")}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-3">
          {error}
        </p>
      )}
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
  return <p aria-live="off">{t("riotLink.timeLeft", { time })}</p>;
}
