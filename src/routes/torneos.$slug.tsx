import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";
import { CupCountdown } from "../components/cup/countdown";
import { NotFound } from "../components/site/not-found";
import { Th } from "../components/team/team-ui";
import { EligibilitySummary } from "../components/tournament/eligibility-summary";
import { PrizeMeter } from "../components/tournament/prize-meter";
import { RegistrationStatusLabel, TournamentStatusTag } from "../components/tournament/registration-status";
import { Button } from "../components/ui/button";
import { getTournamentPage } from "../server/tournaments/tournaments.functions";
import { formatArs } from "../shared/format";
import { t } from "../shared/i18n";
import { ROSTER_STARTERS } from "../shared/tournament";

export const Route = createFileRoute("/torneos/$slug")({
  loader: ({ params }) => getTournamentPage({ data: { slug: params.slug } }),
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: `${t("tournament.notFound")} · ${t("app.name")}` }] };
    const { title, edition } = loaderData;
    return {
      meta: [
        { title: `${title} #${edition} · ${t("app.name")}` },
        { name: "description", content: t("tournament.metaDescription", { title, edition }) },
      ],
    };
  },
  component: TournamentPage,
  notFoundComponent: () => <NotFound message={t("tournament.notFound")} />,
});

type TournamentPageData = Awaited<ReturnType<typeof getTournamentPage>>;

// Only plain web links become clickable; anything else in the field stays text.
const isWebUrl = (url: string) => /^https?:\/\//i.test(url);

function TournamentPage() {
  const tournament = Route.useLoaderData();
  const free = tournament.entryFeeArs === 0;
  return (
    <main>
      <section className="stage relative isolate overflow-hidden px-4 pt-8 pb-10 sm:px-8 md:pt-16 md:pb-14">
        <div className="mx-auto max-w-6xl">
          <TournamentStatusTag status={tournament.status} />
          <p className="mt-6 font-display text-xl font-extrabold tracking-[0.06em] text-ink-muted uppercase">
            {t("tournament.edition", { edition: tournament.edition })}
          </p>
          <h1 className="mt-1 font-display text-[clamp(2.75rem,13vw,5.5rem)] leading-[0.9] font-black tracking-[-0.01em] uppercase [overflow-wrap:anywhere]">
            {tournament.title}
          </h1>
          <CupCountdown startsAt={new Date(tournament.startsAt)} className="mt-5" />
          <p className="mt-5 font-display text-lg font-extrabold tracking-[0.02em] uppercase">
            {t("tournament.format", {
              bracket: t(`cup.bracket.${tournament.bracket}`),
              draftMode: t(`tournament.draftMode.${tournament.draftMode}`),
              bestOf: tournament.bestOf,
              finalsBestOf: tournament.finalsBestOf,
            })}
          </p>
          {tournament.status === "registration_open" && (
            <Button asChild size="lg" className="mt-8">
              <a href={`/torneos/${tournament.slug}/inscribir`}>{t("tournament.register")}</a>
            </Button>
          )}
        </div>
      </section>

      <div className="px-4 py-12 sm:px-8 md:py-16">
        <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-16">
          <div className="flex flex-col gap-12">
            <PrizeMeter
              poolArs={tournament.poolArs}
              goalArs={tournament.prizeGoalArs}
              split={tournament.prizeSplit}
              prizeShares={tournament.prizeShares}
              goalShares={tournament.goalShares}
            />
            <Entry tournament={tournament} />
          </div>
          <div className="flex flex-col gap-12">
            <EligibilitySummary rules={tournament.rules} maxSubs={tournament.maxSubs} />
            <Teams tournament={tournament} free={free} />
            {tournament.rulesText && (
              <Block title={t("tournament.rulesText.title")}>
                <p className="mt-3 whitespace-pre-line">{tournament.rulesText}</p>
              </Block>
            )}
            {isWebUrl(tournament.streamUrl) && (
              <a
                href={tournament.streamUrl}
                className="self-start font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink"
              >
                {t("tournament.stream")}
              </a>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="font-display text-2xl font-extrabold uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Entry({ tournament }: { tournament: TournamentPageData }) {
  if (tournament.entryFeeArs === 0) {
    return (
      <Block title={t("tournament.entry.title")}>
        <p className="mt-3 text-lg font-semibold">{t("tournament.entry.free")}</p>
      </Block>
    );
  }
  return (
    <Block title={t("tournament.entry.title")}>
      <p className="mt-3 text-lg">
        {t("tournament.entry.fee", { fee: formatArs(tournament.entryFeeArs) })} ·{" "}
        <strong className="font-bold">{t("cup.poolNote")}</strong>
      </p>
      {tournament.paymentInstructions && (
        <div className="mt-4 border-t border-line pt-4">
          <h3 className="font-display text-lg font-extrabold text-ink-muted uppercase">{t("tournament.entry.howToPay")}</h3>
          <p className="mt-2 whitespace-pre-line">{tournament.paymentInstructions}</p>
        </div>
      )}
    </Block>
  );
}

function Teams({ tournament, free }: { tournament: TournamentPageData; free: boolean }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={headingId} className="font-display text-2xl font-extrabold uppercase">
          {t("tournament.teams.title")}
        </h2>
        <p className="font-display text-lg font-extrabold uppercase">
          {t("tournament.confirmedCount", { count: tournament.confirmedCount, cap: tournament.teamCap })}
        </p>
      </div>
      {tournament.registrations.length === 0 ? (
        <p className="mt-3 text-ink-muted">{t("tournament.teams.empty")}</p>
      ) : (
        <table aria-labelledby={headingId} className="mt-4 w-full border-collapse text-left">
          <thead>
            <tr>
              <Th>{t("tournament.col.team")}</Th>
              <Th>{t("tournament.col.status")}</Th>
              {!free && <Th>{t("tournament.col.payments")}</Th>}
            </tr>
          </thead>
          <tbody>
            {tournament.registrations.map((r) => (
              <tr key={r.teamSlug} className="border-b border-line align-top">
                <td className="py-3 pr-3">
                  <a
                    href={`/torneos/${tournament.slug}/equipos/${r.teamSlug}`}
                    className="font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:text-cobalt-light hover:underline"
                  >
                    {r.teamName}
                  </a>
                </td>
                <td className="py-3 pr-3">
                  <RegistrationStatusLabel status={r.status} />
                </td>
                {!free && (
                  <td className="py-3 tabular-nums">
                    {t("registration.paidProgress", { paid: r.paidCount, total: ROSTER_STARTERS })}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
