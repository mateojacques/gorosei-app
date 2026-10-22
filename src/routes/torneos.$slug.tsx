import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useId } from "react";
import { CupCountdown } from "../components/cup/countdown";
import { NotFound } from "../components/site/not-found";
import { Th } from "../components/team/team-ui";
import { EligibilitySummary } from "../components/tournament/eligibility-summary";
import { PrizeMeter } from "../components/tournament/prize-meter";
import { RegistrationStatusLabel, TournamentStatusTag } from "../components/tournament/registration-status";
import { Button } from "../components/ui/button";
import { useRealtime } from "../components/matchday/use-realtime";
import { CheckInPanel } from "../components/matchday/check-in-panel";
import { getCheckInPanel } from "../server/matchday/matchday.functions";
import { getTournamentPage } from "../server/tournaments/tournaments.functions";
import { formatArs } from "../shared/format";
import { t } from "../shared/i18n";
import { absoluteUrl, eventJsonLd, jsonLdString, pageMeta } from "../shared/seo";
import { ROSTER_STARTERS } from "../shared/tournament";
import { statusChecklist } from "../shared/viewer-status";
import { BracketView } from "../components/bracket/bracket-view";
import { Schedule } from "../components/tournament/schedule";
import { AfterHero, VodList } from "../components/tournament/stage-after";
import { InPlayList, LiveHero } from "../components/tournament/stage-live";
import { YourStatus } from "../components/tournament/your-status";

export const Route = createFileRoute("/torneos/$slug")({
  loader: async ({ params }) => {
    const [tournament, panel] = await Promise.all([
      getTournamentPage({ data: { slug: params.slug } }),
      getCheckInPanel({ data: { slug: params.slug } }),
    ]);
    return { ...tournament, panel };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: `${t("tournament.notFound")} · ${t("app.name")}` }] };
    const { title, edition, origin, slug } = loaderData;
    const image = `/og/torneos/${slug}.png`;
    const description = t("tournament.metaDescription", { title, edition });
    const event = eventJsonLd({
      origin,
      slug,
      title,
      edition,
      startsAt: new Date(loaderData.startsAt),
      status: loaderData.status,
      entryFeeArs: loaderData.entryFeeArs,
      prizeGoalArs: loaderData.prizeGoalArs,
      description,
      imageUrl: absoluteUrl(origin, image),
    });
    return {
      ...pageMeta({ origin, path: `/torneos/${slug}`, title: `${title} #${edition} · ${t("app.name")}`, description, image }),
      scripts: [{ type: "application/ld+json", children: jsonLdString(event) }],
    };
  },
  component: TournamentPage,
  notFoundComponent: () => <NotFound message={t("tournament.notFound")} />,
});

type TournamentPageData = Awaited<ReturnType<typeof getTournamentPage>>;
type Panel = Awaited<ReturnType<typeof getCheckInPanel>>;

// Only real https links become clickable; anything else in the field stays text.
const isWebUrl = (url: string) => /^https:\/\/[^\s]+$/i.test(url.trim());

type Page = TournamentPageData & { panel: Panel };

function TournamentPage() {
  const tournament = Route.useLoaderData();
  return (
    <main>
      {(tournament.status === "check_in" || tournament.status === "live") && <TournamentRealtime tournamentId={tournament.id} />}
      {tournament.stage === "live" ? (
        <LiveStage tournament={tournament} />
      ) : tournament.stage === "after" ? (
        <AfterStage tournament={tournament} />
      ) : (
        <BeforeStage tournament={tournament} />
      )}
    </main>
  );
}

/** Live updates for everyone on the page while check-in or the bracket is running. */
function TournamentRealtime({ tournamentId }: { tournamentId: string }) {
  useRealtime([`tournament:${tournamentId}`]);
  return null;
}

function BeforeStage({ tournament }: { tournament: Page }) {
  const free = tournament.entryFeeArs === 0;
  const status = tournament.viewerStatus;
  return (
    <>
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
          <FormatLine tournament={tournament} />
          {tournament.status === "registration_open" && (
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <Button asChild size="lg">
                <a href={`/torneos/${tournament.slug}/inscribir`}>{t("tournament.register")}</a>
              </Button>
              <div className="flex flex-col items-start gap-1">
                <Button asChild variant="secondary">
                  <a href={`/torneos/${tournament.slug}/agentes-libres`}>{t("pool.findTeam")}</a>
                </Button>
                {tournament.poolCount > 0 && (
                  <p className="font-display text-base font-extrabold uppercase tabular-nums">
                    {t(tournament.poolCount === 1 ? "pool.count" : "pool.count_other", { count: tournament.poolCount })}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="px-4 py-12 sm:px-8 md:py-16">
        <div className="mx-auto flex max-w-6xl flex-col gap-16">
          <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-16">
            <div className="flex flex-col gap-12">
              {status && (
                <YourStatus
                  steps={statusChecklist({
                    riotLinked: status.riotLinked,
                    free,
                    inPool: status.inPool,
                    registration: status.registration,
                    tournamentStatus: tournament.status,
                    checkedIn: status.checkedIn,
                  })}
                  slug={tournament.slug}
                  teamSlug={status.registration?.teamSlug ?? null}
                  inPool={status.inPool}
                />
              )}
              <MatchDay panel={tournament.panel} tournamentId={tournament.id} />
              <PrizeMeter
                poolArs={tournament.poolArs}
                goalArs={tournament.prizeGoalArs}
                split={tournament.prizeSplit}
                prizeShares={tournament.prizeShares}
                goalShares={tournament.goalShares}
              />
              <Entry tournament={tournament} />
              <Schedule rows={tournament.schedule} />
            </div>
            <div className="flex flex-col gap-12">
              <EligibilitySummary rules={tournament.rules} maxSubs={tournament.maxSubs} />
              <Teams tournament={tournament} free={free} />
              <RulesText text={tournament.rulesText} />
              {isWebUrl(tournament.streamUrl) && (
                <a
                  href={tournament.streamUrl.trim()}
                  rel="noopener noreferrer"
                  className="self-start font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink"
                >
                  {t("tournament.stream")}
                </a>
              )}
            </div>
          </div>
          <BracketSection tournament={tournament} />
        </div>
      </div>
    </>
  );
}

function LiveStage({ tournament }: { tournament: Page }) {
  const free = tournament.entryFeeArs === 0;
  return (
    <>
      <LiveHero title={tournament.title} edition={tournament.edition} streamUrl={tournament.streamUrl} />
      <div className="px-4 py-12 sm:px-8 md:py-16">
        <div className="mx-auto flex max-w-6xl flex-col gap-16">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start lg:gap-16">
            <InPlayList matches={tournament.bracketView?.matches ?? []} />
            <MatchDay panel={tournament.panel} tournamentId={tournament.id} />
          </div>
          <BracketSection tournament={tournament} />
          <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-16">
            <div className="flex flex-col gap-12">
              <Schedule rows={tournament.schedule} />
              <EligibilitySummary rules={tournament.rules} maxSubs={tournament.maxSubs} />
            </div>
            <div className="flex flex-col gap-12">
              <Teams tournament={tournament} free={free} />
              <RulesText text={tournament.rulesText} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function AfterStage({ tournament }: { tournament: Page }) {
  const free = tournament.entryFeeArs === 0;
  const status = tournament.status === "cancelled" ? "cancelled" : "finished";
  return (
    <>
      <AfterHero title={tournament.title} edition={tournament.edition} status={status} results={tournament.results} next={tournament.next} />
      <div className="px-4 py-12 sm:px-8 md:py-16">
        <div className="mx-auto flex max-w-6xl flex-col gap-16">
          {(tournament.bracketView || status === "finished") && <BracketSection tournament={tournament} />}
          <VodList vods={tournament.results?.vods ?? []} />
          <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr] lg:items-start lg:gap-16">
            <div className="flex flex-col gap-12">
              <Teams tournament={tournament} free={free} />
              <Schedule rows={tournament.schedule} />
            </div>
            <div className="flex flex-col gap-12">
              <EligibilitySummary rules={tournament.rules} maxSubs={tournament.maxSubs} />
              <RulesText text={tournament.rulesText} />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function FormatLine({ tournament }: { tournament: Page }) {
  return (
    <p className="mt-5 font-display text-lg font-extrabold tracking-[0.02em] uppercase">
      {t("tournament.format", {
        bracket: t(`cup.bracket.${tournament.bracket}`),
        draftMode: t(`tournament.draftMode.${tournament.draftMode}`),
        bestOf: tournament.bestOf,
        finalsBestOf: tournament.finalsBestOf,
      })}
    </p>
  );
}

/** The bracket stays reachable in every stage; before it exists, the section says when it will. */
function BracketSection({ tournament }: { tournament: Page }) {
  const view = tournament.bracketView;
  return (
    <section aria-labelledby="bracket-h" id="cuadro" className="scroll-mt-6">
      <h2 id="bracket-h" className="font-display text-3xl font-black uppercase">
        {t("stage.bracket.title")}
      </h2>
      <div className="mt-5">
        {view ? (
          <BracketView bracket={view.bracket} matches={view.matches} highlightRegistrationId={tournament.viewerRegistrationId} />
        ) : (
          <p className="max-w-prose text-ink-muted">
            {tournament.stage === "before" ? t("stage.bracket.pending") : t("stage.bracket.none")}
          </p>
        )}
      </div>
    </section>
  );
}

function RulesText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Block title={t("tournament.rulesText.title")}>
      <p className="mt-3 whitespace-pre-line">{text}</p>
    </Block>
  );
}

/** Check-in while it runs, a way into the current match once the bracket is live; nothing for anyone else. */
function MatchDay({ panel, tournamentId }: { panel: Panel; tournamentId: string }) {
  if (!panel) return null;
  if (panel.kind === "check_in") {
    return (
      <div id="check-in" className="scroll-mt-6">
        <CheckInPanel panel={panel} tournamentId={tournamentId} />
      </div>
    );
  }
  return <LivePanel panel={panel} tournamentId={tournamentId} />;
}

function LivePanel({ panel }: { panel: Extract<NonNullable<Panel>, { kind: "live" }>; tournamentId: string }) {
  return (
    <Block title={t("matchday.live.title")}>
      {panel.matchId ? (
        <Button asChild size="lg" className="mt-3">
          <a href={`/partidas/${panel.matchId}`}>{t("matchday.live.go")}</a>
        </Button>
      ) : (
        <p className="mt-3 text-ink-muted">{t("matchday.live.none")}</p>
      )}
    </Block>
  );
}

function Block({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={id ? "scroll-mt-6" : undefined}>
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
      <Block id="pago" title={t("tournament.entry.title")}>
        <p className="mt-3 text-lg font-semibold">{t("tournament.entry.free")}</p>
      </Block>
    );
  }
  return (
    <Block id="pago" title={t("tournament.entry.title")}>
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
