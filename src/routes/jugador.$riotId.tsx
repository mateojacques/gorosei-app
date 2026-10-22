import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { CaptionBar } from "../components/cup/caption-bar";
import { NotFound } from "../components/site/not-found";
import { getProfileBySlug } from "../server/identity/profile.functions";
import { formatLongDate } from "../shared/format";
import { t } from "../shared/i18n";
import { formatRank } from "../shared/rank";
import { formatRiotId } from "../shared/riot-id";

export const Route = createFileRoute("/jugador/$riotId")({
  loader: ({ params }) => getProfileBySlug({ data: { slug: params.riotId } }),
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: `${t("profile.notFound")} · ${t("app.name")}` }] };
    const riotId = formatRiotId(loaderData);
    return {
      meta: [
        { title: `${riotId} · ${t("app.name")}` },
        {
          name: "description",
          content: t("profile.metaDescription", {
            riotId,
            rank: formatRank(loaderData.currentRank),
            peak: formatRank(loaderData.seasonPeak),
          }),
        },
      ],
    };
  },
  component: ProfilePage,
  notFoundComponent: ProfileNotFound,
});

function ProfilePage() {
  const profile = Route.useLoaderData();
  return (
    <main>
      <section className="stage relative isolate overflow-hidden px-4 pt-10 pb-10 sm:px-8 md:pt-16 md:pb-14">
        <div className="mx-auto max-w-4xl">
          <h1 className="font-display text-[clamp(2.75rem,13vw,5.5rem)] leading-[0.9] font-black tracking-[-0.01em] [overflow-wrap:anywhere]">
            {formatRiotId(profile)}
          </h1>
          <CaptionBar block={t("profile.level", { level: profile.summonerLevel })} className="mt-5">
            {t("profile.server")}
          </CaptionBar>
        </div>
      </section>

      <div className="px-4 py-12 sm:px-8 md:py-16">
        <div className="mx-auto max-w-4xl">
          <dl className="grid gap-8 sm:grid-cols-2">
            <RankStat label={t("profile.currentRank")} value={formatRank(profile.currentRank)} />
            <RankStat label={t("profile.seasonPeak")} value={formatRank(profile.seasonPeak)} />
          </dl>

          <ProfileList title={t("profile.teams")} empty={t("profile.noTeams")}>
            {profile.teams.map((team) => (
              <li key={team.slug} className="border-t border-line py-3">
                <a href={`/equipos/${team.slug}`} className="font-semibold underline-offset-4 hover:text-cobalt-light hover:underline">
                  {team.name}
                </a>{" "}
                <span className="text-ink-muted">{t("team.tag", { tag: team.tag })}</span>
              </li>
            ))}
          </ProfileList>
          <ProfileList title={t("profile.tournaments")} empty={t("profile.noTournaments")}>
            {profile.tournaments.map((tournament) => (
              <li key={tournament.slug} className="flex flex-wrap justify-between gap-x-4 border-t border-line py-3">
                <span>
                  <a
                    href={`/torneos/${tournament.slug}`}
                    className="font-semibold underline-offset-4 hover:text-cobalt-light hover:underline"
                  >
                    {tournament.title} #{tournament.edition}
                  </a>{" "}
                  <span className="text-ink-muted">· {tournament.teamName}</span>
                </span>
                <span className="text-ink-muted">{formatLongDate(new Date(tournament.startsAt))}</span>
              </li>
            ))}
          </ProfileList>
        </div>
      </div>
    </main>
  );
}

function RankStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line pt-4">
      <dt className="font-display text-lg font-extrabold tracking-[0.04em] text-ink-muted uppercase">{label}</dt>
      <dd className="mt-1 font-display text-[clamp(2.5rem,10vw,3.5rem)] leading-none font-black text-cobalt-light uppercase">
        {value}
      </dd>
    </div>
  );
}

function ProfileList({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-2xl font-extrabold uppercase">{title}</h2>
      {children.length === 0 ? (
        <p className="mt-2 text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-3 border-b border-line">{children}</ul>
      )}
    </section>
  );
}

function ProfileNotFound() {
  return <NotFound message={t("profile.notFound")} />;
}
