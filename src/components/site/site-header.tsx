import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import type { ViewerState } from "@/server/viewer.functions";
import { t } from "@/shared/i18n";
import { riotIdToSlug } from "@/shared/riot-id";

export function SiteHeader({ viewer }: { viewer: ViewerState }) {
  const sectionLink = buttonVariants({ variant: "ghost", size: "sm", className: "px-2" });
  return (
    <header className="relative z-10 px-4 sm:px-8">
      {/* Phones: wordmark and account on the first row, the section links on a second one. */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 pt-3 sm:h-16 sm:flex-nowrap sm:gap-3 sm:pt-0">
        <Link
          to="/"
          className="font-display text-2xl font-black tracking-[0.06em] text-ink uppercase hover:text-cobalt-light"
        >
          {t("app.name")}
        </Link>
        <nav aria-label={t("site.sections")} className="order-last -ml-2 flex w-full items-center gap-1 py-1 sm:order-none sm:ml-auto sm:w-auto sm:py-0">
          <Link to="/torneos" className={sectionLink}>
            {t("site.tournaments")}
          </Link>
          {viewer.signedIn && viewer.riotAccount && (
            <Link to="/mis-equipos" className={sectionLink}>
              {t("site.myTeams")}
            </Link>
          )}
          {viewer.signedIn && viewer.role === "admin" && (
            <Link to="/admin/torneos" className={sectionLink}>
              {t("site.admin")}
            </Link>
          )}
        </nav>
        <nav aria-label={t("site.nav")}>
          <AccountLink viewer={viewer} />
        </nav>
      </div>
    </header>
  );
}

const linkClass = buttonVariants({ variant: "secondary", size: "sm" });

function AccountLink({ viewer }: { viewer: ViewerState }) {
  if (!viewer.signedIn) {
    return (
      <Link to="/ingresar" className={linkClass}>
        {t("site.signIn")}
      </Link>
    );
  }
  if (!viewer.riotAccount) {
    return (
      <Link to="/vincular-riot" className={linkClass}>
        {t("site.linkRiot")}
      </Link>
    );
  }
  return (
    <a href={`/jugador/${riotIdToSlug(viewer.riotAccount)}`} className={linkClass}>
      {t("site.myProfile")}
    </a>
  );
}
