import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/og/default.png")({
  server: {
    handlers: {
      GET: async () => {
        const { defaultOgResponse } = await import("../server/seo/og");
        return defaultOgResponse();
      },
    },
  },
});
