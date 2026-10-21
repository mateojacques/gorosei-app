import { Link, createFileRoute } from "@tanstack/react-router";
import { t } from "../shared/i18n";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <main className="p-4">
      <h1 className="text-2xl font-bold">{t("app.name")}</h1>
      <p>
        <Link to="/ingresar" className="underline">
          {t("auth.title")}
        </Link>
      </p>
    </main>
  );
}
