import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Field, FormAlert } from "../components/site/form";
import { AdminRegistrations, PlayerPanel } from "../components/tournament/admin-registrations";
import { TournamentStatusTag } from "../components/tournament/registration-status";
import { TournamentForm, toFormValues } from "../components/tournament/tournament-form";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  cancelTournamentFn,
  closeRegistrationFn,
  getAdminRegistrations,
  getAdminTournament,
  openRegistrationFn,
  updateTournamentFn,
} from "../server/tournaments/admin.functions";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/admin/torneos/$id")({
  loader: async ({ params }) => {
    const [tournament, registrations] = await Promise.all([
      getAdminTournament({ data: { id: params.id } }),
      getAdminRegistrations({ data: { id: params.id } }),
    ]);
    return { tournament, registrations };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `${loaderData ? `${loaderData.tournament.title} #${loaderData.tournament.edition}` : t("admin.error.not_found")} · ${t("app.name")}`,
      },
    ],
  }),
  component: AdminTournamentPage,
});

type Tournament = Awaited<ReturnType<typeof getAdminTournament>>;

function AdminTournamentPage() {
  const { tournament, registrations } = Route.useLoaderData();
  return (
    <div className="flex flex-col gap-12">
      <div>
        <Link to="/admin/torneos" className="font-display text-lg font-extrabold text-ink-muted uppercase hover:text-ink">
          {t("admin.backToList")}
        </Link>
        <h1 className="mt-1 font-display text-[clamp(2.5rem,10vw,4rem)] leading-[0.9] font-black uppercase [overflow-wrap:anywhere]">
          {tournament.title} #{tournament.edition}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <TournamentStatusTag status={tournament.status} />
          <a href={`/torneos/${tournament.slug}`} className="text-sm text-ink-muted underline underline-offset-4 hover:text-ink">
            /torneos/{tournament.slug}
          </a>
        </div>
      </div>
      <Lifecycle tournament={tournament} />
      <AdminRegistrations tournamentId={tournament.id} free={tournament.entryFeeArs === 0} registrations={registrations} />
      <PlayerPanel />
      <section className="max-w-3xl">
        <TournamentForm
          // Remount with fresh values after every save or lifecycle change.
          key={`${tournament.id}-${String(tournament.updatedAt)}`}
          initial={toFormValues(tournament)}
          submitLabel={t("admin.form.save")}
          onSubmit={async (input) => {
            const result = await updateTournamentFn({ data: { id: tournament.id, input } });
            return result;
          }}
        />
      </section>
    </div>
  );
}

function Lifecycle({ tournament }: { tournament: Tournament }) {
  const router = useRouter();
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  async function run(action: () => Promise<{ ok: true } | { ok: false; reason: "not_found" | "invalid_state" }>, success?: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(t(`admin.error.${result.reason}`));
        return;
      }
      if (success) setNotice(success);
      setCancelling(false);
      await router.invalidate();
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  const { status } = tournament;
  const cancellable = status !== "finished" && status !== "cancelled";
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-6">
      <h2 className="font-display text-2xl font-extrabold uppercase">{t("admin.lifecycle.title")}</h2>
      <div className="flex flex-wrap items-center gap-4">
        {status === "draft" && (
          <Button disabled={pending} onClick={() => run(() => openRegistrationFn({ data: { id: tournament.id } }))}>
            {t("admin.lifecycle.open")}
          </Button>
        )}
        {status === "registration_open" && (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={async () => {
              let message: string | undefined;
              await run(async () => {
                const result = await closeRegistrationFn({ data: { id: tournament.id } });
                if (result.ok) message = t("admin.lifecycle.closed", { dropped: result.dropped, credited: result.credited });
                return result;
              });
              if (message) setNotice(message);
            }}
          >
            {t("admin.lifecycle.close")}
          </Button>
        )}
        {cancellable && !cancelling && (
          <Button variant="ghost" className="px-0" disabled={pending} onClick={() => setCancelling(true)}>
            {t("admin.lifecycle.cancel")}
          </Button>
        )}
      </div>
      {cancelling && (
        <form
          method="post"
          className="flex max-w-md flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => cancelTournamentFn({ data: { id: tournament.id, reason } }));
          }}
        >
          <p role="status" className="font-semibold">
            {t("admin.lifecycle.cancelWarning")}
          </p>
          <Field id={`${id}-reason`} label={t("admin.lifecycle.cancelReason")}>
            <Input id={`${id}-reason`} value={reason} required onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center gap-4">
            <Button type="submit" variant="secondary" disabled={pending || !reason.trim()}>
              {t("admin.lifecycle.cancelConfirm")}
            </Button>
            <Button type="button" variant="ghost" className="px-0" onClick={() => setCancelling(false)}>
              {t("admin.lifecycle.cancelBack")}
            </Button>
          </div>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <FormAlert>{error}</FormAlert>}
    </section>
  );
}
