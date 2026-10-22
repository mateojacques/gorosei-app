import { type MessageKey, t } from "@/shared/i18n";
import type { StatusStep } from "@/shared/viewer-status";
import { cn } from "@/lib/utils";

type Fix = { href: string; label: MessageKey } | null;

/**
 * The signed-in player's checklist for this cup. Each step says its state in words (not color alone)
 * and links to where it is fixed.
 */
export function YourStatus({
  steps,
  slug,
  teamSlug,
  inPool,
}: {
  steps: StatusStep[];
  slug: string;
  teamSlug: string | null;
  inPool: boolean;
}) {
  const fixFor = (step: StatusStep): Fix => {
    if (step.state === "done") return null;
    switch (step.id) {
      case "riot":
        return { href: "/vincular-riot", label: "yourStatus.fix.riot" };
      case "team":
        if (teamSlug) return { href: `/equipos/${teamSlug}`, label: "yourStatus.fix.team" };
        return inPool ? { href: `/torneos/${slug}/agentes-libres`, label: "yourStatus.fix.pool" } : { href: `/torneos/${slug}/inscribir`, label: "yourStatus.fix.register" };
      case "payment":
        return { href: "#pago", label: "yourStatus.fix.payment" };
      case "check_in":
        return { href: "#check-in", label: "yourStatus.fix.checkIn" };
    }
  };
  return (
    <section aria-labelledby="your-status-h" className="flex flex-col gap-3">
      <h2 id="your-status-h" className="font-display text-2xl font-extrabold uppercase">
        {t("yourStatus.title")}
      </h2>
      <ol className="border-b border-line">
        {steps.map((step) => {
          const fix = fixFor(step);
          return (
            <li key={step.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line py-3">
              <span
                aria-hidden="true"
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-[4px] font-display text-lg leading-none font-black",
                  step.state === "done" && "bg-cobalt-light text-surface",
                  step.state === "pending" && "border-2 border-cobalt-light text-cobalt-light",
                  step.state === "todo" && "border-2 border-line text-ink-muted",
                )}
              >
                {step.state === "done" ? "✓" : step.state === "pending" ? "…" : ""}
              </span>
              <span className="min-w-0 flex-1">
                <span className="sr-only">{t(`yourStatus.state.${step.state}`)}: </span>
                <span className={step.state === "done" ? "text-ink-muted" : "font-semibold"}>{stepLabel(step, inPool)}</span>
              </span>
              {fix && (
                <a href={fix.href} className="font-semibold text-cobalt-light underline underline-offset-4 hover:text-ink">
                  {t(fix.label)}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function stepLabel(step: StatusStep, inPool: boolean): string {
  if (step.id === "team" && step.state === "pending" && !step.progress && inPool) return t("yourStatus.team.pendingPool");
  const key = `yourStatus.${step.id}.${step.state}` as MessageKey;
  return step.progress ? t(key, { have: step.progress.have, need: step.progress.need }) : t(key);
}
