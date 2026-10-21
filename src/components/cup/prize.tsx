import type { CSSProperties } from "react";
import { formatArs } from "@/shared/format";
import { t } from "@/shared/i18n";

export function Prize({ amountArs }: { amountArs: number }) {
  const amount = formatArs(amountArs);
  return (
    <div className="@container">
      <p
        // Font size follows the amount's length so a long prize shrinks instead of clipping.
        style={{ "--chars": amount.length } as CSSProperties}
        className="prize-settle font-display leading-[0.9] font-black tracking-[-0.01em] text-cobalt-light [font-size:min(9rem,calc(100cqi/(var(--chars)*0.5)))]"
      >
        {amount}
      </p>
      <p className="mt-3 text-lg font-semibold text-ink">{t("cup.prizeCaption")}</p>
    </div>
  );
}
