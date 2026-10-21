import { createFileRoute, useLoaderData } from "@tanstack/react-router";
import { CupCta } from "../components/cup/cup-cta";
import { CupFacts } from "../components/cup/cup-facts";
import { Prize } from "../components/cup/prize";
import { Stage } from "../components/cup/stage";
import { featuredCup } from "../shared/featured-cup";
import { formatArs, formatCupDay, formatCupTime } from "../shared/format";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: t("cup.metaTitle", { edition: featuredCup.edition }) },
      {
        name: "description",
        content: t("cup.metaDescription", {
          prize: formatArs(featuredCup.prizeArs),
          day: formatCupDay(featuredCup.startsAt),
          time: formatCupTime(featuredCup.startsAt),
        }),
      },
    ],
  }),
  component: CupLanding,
});

function CupLanding() {
  const viewer = useLoaderData({ from: "__root__" });
  return (
    <main>
      <Stage cup={featuredCup} />
      <section className="px-4 py-12 sm:px-8 md:py-20">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1.1fr_1fr] lg:items-start lg:gap-16">
          <Prize amountArs={featuredCup.prizeArs} />
          <div className="flex flex-col gap-10">
            <CupFacts cup={featuredCup} />
            <CupCta viewer={viewer} />
          </div>
        </div>
      </section>
    </main>
  );
}
