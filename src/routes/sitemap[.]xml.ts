import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const [{ db }, { env }, { listSitemapEntries }, { siteOrigin }, { sitemapXml }] = await Promise.all([
          import("../server/db/client"),
          import("../server/env"),
          import("../server/seo/sitemap"),
          import("../server/seo/origin"),
          import("../shared/seo"),
        ]);
        const xml = sitemapXml(siteOrigin(env.BETTER_AUTH_URL), await listSitemapEntries(db));
        return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
      },
    },
  },
});
