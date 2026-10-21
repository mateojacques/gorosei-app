import type { ReactNode } from "react";
import type { FeaturedCup } from "@/shared/featured-cup";
import { formatArs } from "@/shared/format";
import { t } from "@/shared/i18n";

export function CupFacts({ cup }: { cup: FeaturedCup }) {
  return (
    <dl className="border-b border-line">
      <Fact label={t("cup.who")}>{t("cup.whoValue", { rank: t(`rank.tier.${cup.rankCap}`) })}</Fact>
      <Fact label={t("cup.what")}>
        {t("cup.whatValue", { bracket: t(`cup.bracket.${cup.bracket}`), teams: cup.teamCap })}
      </Fact>
      <Fact label={t("cup.where")}>
        {t("cup.whereValue")}{" "}
        <a href={cup.streamUrl} className="font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink">
          {t("cup.whereStream")}
        </a>
        .
      </Fact>
      <Fact label={t("cup.entry")}>
        {t("cup.entryValue", { fee: formatArs(cup.entryFeeArs) })} ·{" "}
        <strong className="font-bold text-ink">{t("cup.poolNote")}</strong>
      </Fact>
    </dl>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line py-4 sm:grid-cols-[8rem_1fr] sm:gap-4">
      <dt className="font-display text-lg leading-tight font-extrabold tracking-[0.04em] text-ink-muted uppercase">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
