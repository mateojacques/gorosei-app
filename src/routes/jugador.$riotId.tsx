import { createFileRoute } from "@tanstack/react-router";
import { getProfileBySlug } from "../server/identity/profile.functions";
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
    <main className="mx-auto max-w-2xl p-4">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">{formatRiotId(profile)}</h1>
        <p>{t("profile.level", { level: profile.summonerLevel })}</p>
      </header>

      <dl className="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="font-bold">{t("profile.currentRank")}</dt>
        <dd>{formatRank(profile.currentRank)}</dd>
        <dt className="font-bold">{t("profile.seasonPeak")}</dt>
        <dd>{formatRank(profile.seasonPeak)}</dd>
      </dl>

      <section className="mb-6">
        <h2 className="text-xl font-bold">{t("profile.teams")}</h2>
        <p>{t("profile.noTeams")}</p>
      </section>

      <section>
        <h2 className="text-xl font-bold">{t("profile.tournaments")}</h2>
        <p>{t("profile.noTournaments")}</p>
      </section>
    </main>
  );
}

function ProfileNotFound() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <p>{t("profile.notFound")}</p>
    </main>
  );
}
