import { Link, createFileRoute, useLoaderData } from "@tanstack/react-router";
import { CupCta } from "../components/cup/cup-cta";
import { CupFacts } from "../components/cup/cup-facts";
import { Prize } from "../components/cup/prize";
import { Stage } from "../components/cup/stage";
import { getLandingTournament } from "../server/tournaments/tournaments.functions";
import { getSiteOrigin } from "../server/viewer.functions";
import { formatArs, formatCupDay, formatCupTime } from "../shared/format";
import { t } from "../shared/i18n";
import { splitPrize } from "../shared/prize";
import { DEFAULT_OG_IMAGE, pageMeta } from "../shared/seo";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [tournament, origin] = await Promise.all([getLandingTournament(), getSiteOrigin()]);
    return { tournament, origin };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const { tournament, origin } = loaderData;
    if (!tournament) {
      return pageMeta({ origin, path: "/", title: t("cup.metaTitleNone"), description: t("cup.metaDescriptionNone"), image: DEFAULT_OG_IMAGE });
    }
    const startsAt = new Date(tournament.startsAt);
    return pageMeta({
      origin,
      path: "/",
      title: t("cup.metaTitle", { title: tournament.title, edition: tournament.edition }),
      description: t("cup.metaDescription", {
        title: tournament.title,
        prize: formatArs(championGoal(tournament)),
        day: formatCupDay(startsAt),
        time: formatCupTime(startsAt),
      }),
      // The landing promotes the featured cup, so a shared link shows that cup's card.
      image: `/og/torneos/${tournament.slug}.png`,
    });
  },
  component: CupLanding,
});

// The big number is the champion's share of the prize goal, captioned as such; the live pool sits by the fee.
const championGoal = (tournament: { prizeGoalArs: number; prizeSplit: number[] }) =>
  splitPrize(tournament.prizeGoalArs, tournament.prizeSplit)[0] ?? 0;

function SeeAll() {
  return (
    <Link to="/torneos" className="mt-6 inline-block font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink">
      {t("browse.seeAll")}
    </Link>
  );
}

function CupLanding() {
  const viewer = useLoaderData({ from: "__root__" });
  const { tournament } = Route.useLoaderData();
  return (
    <main>
      <Stage tournament={tournament} />
      <section className="px-4 py-12 sm:px-8 md:py-20">
        {tournament ? (
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-start lg:gap-16">
            <Prize amountArs={championGoal(tournament)} caption={t("cup.prizeCaptionGoal")} />
            <div className="flex flex-col gap-10">
              <CupFacts tournament={tournament} />
              <CupCta viewer={viewer} tournament={tournament} />
              <SeeAll />
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl">
            <CupCta viewer={viewer} tournament={null} />
            <SeeAll />
          </div>
        )}
      </section>
    </main>
  );
}
