import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";
import type { ViewerState } from "@/server/viewer.functions";
import { t } from "@/shared/i18n";
import { riotIdToSlug } from "@/shared/riot-id";

export function SiteHeader({ viewer }: { viewer: ViewerState }) {
  return (
    <header className="relative z-10 px-4 sm:px-8">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4">
        <Link
          to="/"
          className="font-display text-2xl font-black tracking-[0.06em] text-ink uppercase hover:text-cobalt-light"
        >
          {t("app.name")}
        </Link>
        <nav aria-label={t("site.nav")} className="flex items-center gap-1 sm:gap-3">
          {viewer.signedIn && viewer.role === "admin" && (
            <Link to="/admin/torneos" className={buttonVariants({ variant: "ghost", size: "sm", className: "px-2" })}>
              {t("site.admin")}
            </Link>
          )}
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
    <div className="flex items-center gap-1 sm:gap-3">
      <Link to="/mis-equipos" className={buttonVariants({ variant: "ghost", size: "sm", className: "px-2" })}>
        {t("site.myTeams")}
      </Link>
      <a href={`/jugador/${riotIdToSlug(viewer.riotAccount)}`} className={linkClass}>
        {t("site.myProfile")}
      </a>
    </div>
  );
}
