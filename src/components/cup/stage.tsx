import type { FeaturedCup } from "@/shared/featured-cup";
import { t } from "@/shared/i18n";
import { CupCountdown } from "./countdown";

export function Stage({ cup }: { cup: FeaturedCup }) {
  return (
    <section aria-labelledby="cup-title" className="stage relative isolate overflow-hidden px-4 pt-8 pb-10 sm:px-8 md:pt-16 md:pb-16">
      <div className="mx-auto max-w-6xl">
        <p className="inline-flex items-center gap-2 bg-signal px-2.5 py-1 font-display text-base leading-none font-extrabold tracking-[0.08em] text-white uppercase">
          <span aria-hidden="true" className="status-dot size-2 rounded-full bg-white" />
          {t(`cup.status.${cup.status}`)}
        </p>
        <p className="mt-6 font-display text-xl font-extrabold tracking-[0.06em] text-ink-muted uppercase">
          {t("cup.edition", { edition: cup.edition })}
        </p>
        <h1
          id="cup-title"
          className="mt-1 font-display text-[clamp(3.5rem,19vw,6rem)] leading-[0.85] font-black tracking-[-0.01em] uppercase"
        >
          <span className="rise block">{t("cup.title.line1")}</span>{" "}
          <span className="rise rise-delay block text-cobalt-light">{t("cup.title.line2")}</span>
        </h1>
        <CupCountdown startsAt={cup.startsAt} className="mt-5" />
      </div>
    </section>
  );
}
