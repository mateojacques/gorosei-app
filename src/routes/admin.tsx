import { Outlet, createFileRoute } from "@tanstack/react-router";
import { adminGate } from "../server/tournaments/admin.functions";

// Every /admin page sits behind this gate; non-admins get the ordinary not-found page.
export const Route = createFileRoute("/admin")({
  loader: () => adminGate(),
  head: () => ({ meta: [{ name: "robots", content: "noindex" }] }),
  component: () => (
    <main className="px-4 py-10 sm:px-8 md:py-14">
      <div className="mx-auto max-w-6xl">
        <Outlet />
      </div>
    </main>
  ),
});
