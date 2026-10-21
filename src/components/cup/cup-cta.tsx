import { Button, buttonVariants } from "@/components/ui/button";
import type { ViewerState } from "@/server/viewer.functions";
import { t } from "@/shared/i18n";
import { getLandingCta } from "@/shared/landing-cta";

export function CupCta({ viewer }: { viewer: ViewerState }) {
  const cta = getLandingCta(viewer);
  // Linked players have nothing to do yet: a confirmation, not a red call to action.
  if (cta.labelKey === "cup.cta.ready") {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="status" className="font-display text-2xl leading-tight font-extrabold text-ink uppercase">
          {t(cta.labelKey)}
        </p>
        <a href={cta.href} className={buttonVariants({ variant: "secondary" })}>
          {t("cup.cta.readyNote")}
        </a>
      </div>
    );
  }
  return (
    <Button asChild size="lg" className="w-full sm:w-auto">
      <a href={cta.href}>{t(cta.labelKey)}</a>
    </Button>
  );
}
