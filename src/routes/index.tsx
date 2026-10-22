import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { CupCta } from "../components/cup/cup-cta";
import { CupFacts } from "../components/cup/cup-facts";
import { Prize } from "../components/cup/prize";
import { Stage } from "../components/cup/stage";
import { getLandingTournament } from "../server/tournaments/tournaments.functions";
import { formatArs, formatCupDay, formatCupTime } from "../shared/format";
import { t } from "../shared/i18n";
import { splitPrize } from "../shared/prize";

export const Route = createFileRoute("/")({
  loader: () => getLandingTournament(),
  head: ({ loaderData: tournament }) => {
    if (!tournament) {
      return { meta: [{ title: t("cup.metaTitleNone") }, { name: "description", content: t("cup.metaDescriptionNone") }] };
    }
    const startsAt = new Date(tournament.startsAt);
    return {
      meta: [
        { title: t("cup.metaTitle", { title: tournament.title, edition: tournament.edition }) },
        {
          name: "description",
          content: t("cup.metaDescription", {
            title: tournament.title,
            prize: formatArs(championGoal(tournament)),
            day: formatCupDay(startsAt),
            time: formatCupTime(startsAt),
          }),
        },
      ],
    };
  },
  component: CupLanding,
});

// The big number is the champion's share of the prize goal, captioned as such; the live pool sits by the fee.
const championGoal = (tournament: { prizeGoalArs: number; prizeSplit: number[] }) =>
  splitPrize(tournament.prizeGoalArs, tournament.prizeSplit)[0] ?? 0;

function CupLanding() {
  const viewer = useLoaderData({ from: "__root__" });
  const tournament = Route.useLoaderData();
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
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-6xl">
            <CupCta viewer={viewer} tournament={null} />
          </div>
        )}
      </section>
    </main>
  );
}
