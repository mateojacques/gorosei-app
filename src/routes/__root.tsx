import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { SiteFooter } from "../components/site/site-footer";
import { NotFound } from "../components/site/not-found";
import { SiteHeader } from "../components/site/site-header";
import { getSiteOrigin, getViewerState } from "../server/viewer.functions";
import { t } from "../shared/i18n";
import { DEFAULT_OG_IMAGE, absoluteUrl } from "../shared/seo";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  loader: async () => {
    const [viewer, origin] = await Promise.all([getViewerState(), getSiteOrigin()]);
    return { ...viewer, origin };
  },
  // Global defaults; each page's own meta (deeper in the tree) replaces these by name.
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#0b1013" },
      { title: t("app.name") },
      { property: "og:site_name", content: t("app.name") },
      { property: "og:locale", content: "es_AR" },
      ...(loaderData
        ? [
            { property: "og:image", content: absoluteUrl(loaderData.origin, DEFAULT_OG_IMAGE) },
            { name: "twitter:image", content: absoluteUrl(loaderData.origin, DEFAULT_OG_IMAGE) },
            { name: "twitter:card", content: "summary_large_image" },
          ]
        : []),
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
