import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async () => {
        const [{ env }, { siteOrigin }, { robotsTxt }] = await Promise.all([
          import("../server/env"),
          import("../server/seo/origin"),
          import("../shared/seo"),
        ]);
        return new Response(robotsTxt(siteOrigin(env.BETTER_AUTH_URL)), {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
        });
      },
    },
  },
});
