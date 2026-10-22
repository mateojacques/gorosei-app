import { Link, createFileRoute } from "@tanstack/react-router";
import { LobbyBox } from "../components/matchday/lobby-box";
import { MatchChat } from "../components/matchday/match-chat";
import { MatchHeader } from "../components/matchday/match-header";
import { MatchStatsTable } from "../components/matchday/match-stats";
import { ReportForm, ReportList, reportSummary } from "../components/matchday/report-form";
import { useRealtime } from "../components/matchday/use-realtime";
import { VodBox } from "../components/matchday/vod-box";
import { NotFound } from "../components/site/not-found";
import { getMatchPage } from "../server/matchday/matchday.functions";
import { t } from "../shared/i18n";
import { isModerator } from "../shared/match";
import { NOINDEX_META } from "../shared/seo";

export const Route = createFileRoute("/partidas/$matchId")({
  loader: ({ params }) => getMatchPage({ data: { matchId: params.matchId } }),
  head: () => ({ meta: [{ title: `${t("matchday.live.title")} · ${t("app.name")}` }, NOINDEX_META] }),
  component: MatchPage,
  notFoundComponent: () => <NotFound message={t("matchday.error.not_found")} />,
});

function MatchPage() {
  const { match, tournament, messages, captainSide, viewer, canSeePrivate } = Route.useLoaderData();
  const moderator = viewer !== null && isModerator(viewer.role);
  useRealtime(canSeePrivate ? [`match:${match.id}`, `chat:${match.id}`] : [`match:${match.id}`]);
  const canReport = captainSide !== null && match.status !== "completed" && match.status !== "waiting";
  const summary = reportSummary(match);
  return (
    <main className="px-4 py-10 sm:px-8 md:py-14">
      <div className="mx-auto flex max-w-4xl flex-col gap-10">
        <div>
          <Link
            to="/torneos/$slug"
            params={{ slug: tournament.slug }}
            className="mb-4 inline-block font-display text-lg font-extrabold text-ink-muted uppercase hover:text-ink"
          >
            {t("matchday.back")}
          </Link>
          <MatchHeader match={match} tournament={tournament} />
        </div>

        {canSeePrivate && match.status !== "waiting" && <LobbyBox matchId={match.id} lobby={match.lobby} canCreate={moderator} />}

        <section aria-labelledby="result-h" className="flex flex-col gap-4">
          <h2 id="result-h" className="font-display text-2xl font-extrabold uppercase">
            {t("matchday.report.title")}
          </h2>
          {summary && <p role="status">{summary}</p>}
          {match.reports.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="font-display text-lg font-extrabold text-ink-muted uppercase">{t("matchday.report.list")}</h3>
              <ReportList match={match} />
            </div>
          )}
          {canReport && captainSide !== null ? (
            <ReportForm key={`${match.id}-${match.reports.length}-${match.status}`} match={match} side={captainSide} />
          ) : (
            canSeePrivate &&
            match.status !== "completed" &&
            match.status !== "waiting" && <p className="text-ink-muted">{t("matchday.report.captainsOnly")}</p>
          )}
        </section>

        {match.stats && match.stats.length > 0 && <MatchStatsTable stats={match.stats} />}
        <VodBox key={match.vodUrl ?? ""} matchId={match.id} vodUrl={match.vodUrl} canEdit={moderator} />
        {canSeePrivate && <MatchChat matchId={match.id} messages={messages} />}
      </div>
    </main>
  );
}
