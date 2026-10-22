import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { CaptionBar } from "../components/cup/caption-bar";
import { FormAlert } from "../components/site/form";
import { NotFound } from "../components/site/not-found";
import { RegistrationStatus } from "../components/tournament/registration-status";
import { RosterPicker } from "../components/tournament/roster-picker";
import { RosterTable } from "../components/tournament/roster-table";
import { Button } from "../components/ui/button";
import { getRegistrationPage, updateRosterFn, withdrawRegistrationFn } from "../server/tournaments/tournaments.functions";
import { t } from "../shared/i18n";
import { ROSTER_STARTERS } from "../shared/tournament";

export const Route = createFileRoute("/torneos/$slug_/equipos/$teamSlug")({
  loader: ({ params }) => getRegistrationPage({ data: { slug: params.slug, teamSlug: params.teamSlug } }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: loaderData
          ? `${loaderData.registration.team.name} · ${loaderData.tournament.title} #${loaderData.tournament.edition}`
          : t("registration.error.not_found"),
      },
    ],
  }),
  component: RegistrationPage,
  notFoundComponent: () => <NotFound message={t("registration.error.not_found")} />,
});

type PageData = Awaited<ReturnType<typeof getRegistrationPage>>;

function RegistrationPage() {
  const { tournament, registration, isCaptain, members } = Route.useLoaderData();
  const free = tournament.entryFeeArs === 0;
  const active = registration.status !== "withdrawn" && registration.status !== "dropped" && registration.status !== "forfeited";
  const editable = active && (tournament.status === "registration_open" || tournament.status === "registration_closed");
  return (
    <main>
      <section className="stage relative isolate overflow-hidden px-4 pt-10 pb-10 sm:px-8 md:pt-16 md:pb-14">
        <div className="mx-auto max-w-4xl">
          <a href={`/torneos/${tournament.slug}`} className="font-display text-xl font-extrabold tracking-[0.06em] text-ink-muted uppercase hover:text-ink">
            {tournament.title} #{tournament.edition}
          </a>
          <h1 className="mt-1 font-display text-[clamp(2.75rem,13vw,5.5rem)] leading-[0.9] font-black tracking-[-0.01em] uppercase [overflow-wrap:anywhere]">
            <a href={`/equipos/${registration.team.slug}`} className="hover:text-cobalt-light">
              {registration.team.name}
            </a>
          </h1>
          <CaptionBar block={t("team.tag", { tag: registration.team.tag })} className="mt-5">
            {free ? t(`registration.status.${registration.status}`) : t("registration.paidProgress", { paid: registration.paidCount, total: ROSTER_STARTERS })}
          </CaptionBar>
        </div>
      </section>

      <div className="px-4 py-12 sm:px-8 md:py-16">
        <div className="mx-auto flex max-w-4xl flex-col gap-12">
          <RegistrationStatus status={registration.status} free={free} />
          <RosterTable roster={registration.roster} showPaid={!free} />
          {isCaptain && editable && <CaptainActions registration={registration} members={members} maxSubs={tournament.maxSubs} />}
        </div>
      </div>
    </main>
  );
}

function CaptainActions({
  registration,
  members,
  maxSubs,
}: {
  registration: PageData["registration"];
  members: PageData["members"];
  maxSubs: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const initial = {
    starters: registration.roster.filter((p) => !p.isSub).map((p) => p.userId),
    subs: registration.roster.filter((p) => p.isSub).map((p) => p.userId),
  };
  return (
    <section className="flex flex-col gap-8 border-t border-line pt-8">
      {editing ? (
        <div className="flex flex-col gap-4">
          <RosterPicker
            members={members}
            maxSubs={maxSubs}
            initial={initial}
            submitLabel={t("registration.edit.submit")}
            onSubmit={async (roster) => {
              const result = await updateRosterFn({ data: { registrationId: registration.id, roster } });
              if (result.ok) {
                setEditing(false);
                await router.invalidate();
              }
              return result;
            }}
          />
          <Button variant="ghost" className="self-start px-0" onClick={() => setEditing(false)}>
            {t("registration.edit.cancel")}
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
          {t("registration.edit")}
        </Button>
      )}
      <Withdraw registrationId={registration.id} confirmed={registration.status === "confirmed"} />
    </section>
  );
}

function Withdraw({ registrationId, confirmed }: { registrationId: string; confirmed: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setPending(true);
    setError(null);
    try {
      const result = await withdrawRegistrationFn({ data: { registrationId } });
      if (!result.ok) setError(t(`registration.error.${result.reason}`));
      else await router.invalidate();
    } catch {
      setError(t("common.error"));
    } finally {
      setPending(false);
    }
  }

  if (!asking) {
    return (
      <Button variant="ghost" className="self-start px-0" onClick={() => setAsking(true)}>
        {t("registration.withdraw")}
      </Button>
    );
  }
  return (
    <div className="flex flex-col items-start gap-4">
      <p role="status" className="max-w-prose font-semibold">
        {confirmed ? t("registration.withdraw.warningConfirmed") : t("registration.withdraw.warning")}
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" disabled={pending} onClick={withdraw}>
          {t("registration.withdraw.confirm")}
        </Button>
        <Button variant="ghost" className="px-0" disabled={pending} onClick={() => setAsking(false)}>
          {t("registration.edit.cancel")}
        </Button>
      </div>
      {error && <FormAlert>{error}</FormAlert>}
    </div>
  );
}
