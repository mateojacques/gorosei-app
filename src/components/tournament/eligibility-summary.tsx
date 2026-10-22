import { useId } from "react";
import { t } from "@/shared/i18n";
import { ROSTER_STARTERS } from "@/shared/tournament";

export function EligibilitySummary({ rules, maxSubs }: { rules: string[]; maxSubs: number }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="font-display text-2xl font-extrabold uppercase">
        {t("tournament.rules.title")}
      </h2>
      <ul className="mt-3 flex flex-col border-b border-line">
        {rules.length === 0 && <li className="border-t border-line py-3">{t("tournament.rules.none")}</li>}
        {rules.map((rule) => (
          <li key={rule} className="border-t border-line py-3">
            {rule}
          </li>
        ))}
        <li className="border-t border-line py-3">
          {maxSubs === 0
            ? t("tournament.rules.roster_noSubs", { starters: ROSTER_STARTERS })
            : t(maxSubs === 1 ? "tournament.rules.roster" : "tournament.rules.roster_other", { starters: ROSTER_STARTERS, subs: maxSubs })}
        </li>
      </ul>
    </section>
  );
}
