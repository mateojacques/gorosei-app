import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteFooter } from "../components/site/site-footer";
import { NotFound } from "../components/site/not-found";
import { SiteHeader } from "../components/site/site-header";
import { getViewerState } from "../server/viewer.functions";
import { t } from "../shared/i18n";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  loader: () => getViewerState(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0b1013" },
      { title: t("app.name") },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  notFoundComponent: () => <NotFound message={t("notFound.page")} />,
});

function RootLayout() {
  const viewer = Route.useLoaderData();
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader viewer={viewer} />
      <Outlet />
      <SiteFooter />
    </div>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
