import { Link } from "@tanstack/react-router";
import { t } from "@/shared/i18n";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 text-sm text-ink-muted">
        <Link to="/privacidad" className="w-fit font-semibold text-ink underline-offset-4 hover:underline">
          {t("site.privacy")}
        </Link>
        <p lang="en" className="max-w-[70ch] text-xs leading-relaxed">
          {t("site.riotNotice")}
        </p>
      </div>
    </footer>
  );
}
