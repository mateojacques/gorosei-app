import { type EligibilityFailure, formatFailure } from "@/shared/eligibility";
import { t } from "@/shared/i18n";

export function FailureList({ failures }: { failures: EligibilityFailure[] }) {
  return (
    <div role="alert" className="border border-line bg-surface-raised px-3 py-2.5 text-sm">
      <p className="font-semibold">{t("registration.failures")}</p>
      <ul className="mt-1 list-disc pl-5">
        {failures.map((f, i) => (
          <li key={`${f.ruleId}-${f.userId ?? i}`}>{formatFailure(f)}</li>
        ))}
      </ul>
    </div>
  );
}
