import { createFileRoute } from "@tanstack/react-router";

// The param is "<slug>.png"; tournamentOgResponse strips the extension and 404s anything else.
export const Route = createFileRoute("/og/torneos/$slug")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const [{ db }, { tournamentOgResponse }] = await Promise.all([import("../server/db/client"), import("../server/seo/og")]);
        return tournamentOgResponse(db, params.slug);
      },
    },
  },
});
